"""
Four ways to stay on AWS and cut the Fabric run-rate hard.
Baseline is scenario B from cost_model.py ($666.33/month, eu-west-1).

Every rate below is eu-west-1 list price, checked 3-4 September 2026.
New rates introduced here (not in the main model):
  ec_t4g_micro      0.0170  $/node-hr   Holori, eu-west-1
  ec2_t4g_small     0.0184  $/hr        Holori, eu-west-1
  ec2_t4g_medium    0.0368  $/hr        = 2 x small (AWS T-family doubles)
  ec2_t4g_large     0.0736  $/hr        = 4 x small
  ec2_sp_1yr_disc   0.37                EC2 Instance Savings Plan, 1yr no-upfront
  ebs_gp3_gb_mo     0.0836  $/GB-mo     eu-west-1
  lightsail_4gb     24.00   $/mo        2 vCPU / 4 GB / 80 GB / 4 TB transfer
  lightsail_pg_1gb  15.00   $/mo        managed Postgres bundle
"""
import json

M = json.load(open("/sessions/clever-blissful-newton/mnt/outputs/model.json"))
R = dict(M["rates"])
H = M["hours_per_month"]
B = [s for s in M["scenarios"] if s["name"].startswith("Modest")][0]
L = dict(B["lines"])
BASE = B["aws"]

R.update({
    "ec_t4g_micro": 0.0170,
    "ec2_t4g_small": 0.0184,
    "ec2_t4g_medium": 0.0368,
    "ec2_t4g_large": 0.0736,
    "ebs_gp3_gb_mo": 0.0836,
    "lightsail_4gb": 24.00,
    "lightsail_pg_1gb": 15.00,
})
SP_1YR = 0.37   # EC2 Instance Savings Plan, 1-year no-upfront, t4g in eu-west-1

TASKS = B["tasks"]                      # [name, count, vcpu, gb]
N_TASKS = sum(t[1] for t in TASKS)


def fargate(tasks, arm=True, spot_names=()):
    """Cost of a task list, optionally ARM and optionally Spot per service."""
    tot = 0.0
    for name, n, vcpu, gb in tasks:
        spot = name in spot_names
        if arm and spot:
            cv, cm = 0.00974717, 0.00107165
        elif arm:
            cv, cm = R["fargate_arm_vcpu_hr"], R["fargate_arm_gb_hr"]
        elif spot:
            cv, cm = 0.01218547, 0.00133805
        else:
            cv, cm = R["fargate_vcpu_hr"], R["fargate_gb_hr"]
        tot += n * vcpu * H * cv + n * gb * H * cm
    return tot


# ---------------------------------------------------------------- tier 1
# Same architecture. Remove the three structural costs that buy little at
# this scale: NAT Gateways, Multi-AZ Redis, and x86 on-demand Fargate.
def tier1():
    d = []
    # 1. No NAT. Tasks move to public subnets with public IPv4 and closed
    #    inbound SGs; the API Gateway VPC Link still reaches them in-VPC.
    ip_cost = N_TASKS * R["eip_hr"] * H
    d.append(("Delete 3 NAT Gateways + 3 Elastic IPs; run tasks in public "
              "subnets with public IPv4 and inbound-closed security groups",
              -(L["NAT Gateway (hourly)"] + L["NAT Gateway (data processed)"]
                + L["Elastic IPs"]) + ip_cost))
    # 2. Redis: the queue tier needs durability, the cache tier does not, and
    #    neither needs a standby at this scale.
    new_redis = R["ec_t4g_small"] * H + R["ec_t4g_micro"] * H
    d.append(("Redis: 2 Multi-AZ pairs of cache.t4g.medium -> 1 single-node "
              "t4g.small (queue) + 1 single-node t4g.micro (cache)",
              -(L["ElastiCache Redis nodes"] - new_redis)))
    # 3. Graviton everywhere; Spot for the three interrupt-tolerant services.
    new_fg = fargate(TASKS, arm=True, spot_names=("worker", "dashboard", "admin-console"))
    old_fg = L["Fargate compute (steady state)"]
    d.append(("Fargate on Graviton, with worker/dashboard/admin-console on "
              "Fargate Spot (API stays on-demand)", -(old_fg - new_fg)))
    # 4. Observability trims already identified in the report
    d.append(("Container Insights off (Grafana Cloud already carries it)",
              -L["Container Insights (standard, billed as custom metrics)"]))
    d.append(("CloudWatch logs: 30-day retention, Infrequent Access class",
              -(L["CloudWatch Logs storage (90-day retention)"] * (2 / 3)
                + L["CloudWatch Logs ingestion"] * 0.50)))
    return d


# ---------------------------------------------------------------- tier 2
# Tier 1 plus: accept single-AZ for the database, with PITR as the recovery
# path instead of automatic failover.
def tier2():
    d = tier1()
    new_db = R["rds_t4g_small"] * H + 50 * R["rds_gp3_gb_mo_singleaz"]
    old_db = (L["RDS PostgreSQL instance (Multi-AZ)"] + L["RDS gp3 storage (Multi-AZ)"]
              + L.get("RDS Proxy", 0.0))
    d.append(("RDS: Multi-AZ db.t4g.medium + 100 GB -> single-AZ db.t4g.small "
              "+ 50 GB, PITR on, RDS Proxy dropped (no autoscaling to pool for)",
              -(old_db - new_db)))
    return d


# ---------------------------------------------------------------- tier 3
# Same AWS account, different compute model: one EC2 box running the whole
# Compose stack. Fargate, ElastiCache, API Gateway, VPC Link and Cloud Map all
# disappear; CloudFront stays (it is free at this volume).
def tier3():
    keep = {
        "EC2 t4g.large (2 vCPU / 8 GB), 1-yr EC2 Instance Savings Plan":
            R["ec2_t4g_large"] * H * (1 - SP_1YR),
        "EBS gp3 root + data volume, 60 GB": 60 * R["ebs_gp3_gb_mo"],
        "Public IPv4 address": R["eip_hr"] * H,
        "RDS PostgreSQL single-AZ db.t4g.small, 50 GB gp3, PITR":
            R["rds_t4g_small"] * H + 50 * R["rds_gp3_gb_mo_singleaz"],
        "CloudFront (3 distributions, inside the perpetual free tier)": 0.0,
        "CloudWatch Logs, 30-day IA class": L["CloudWatch Logs ingestion"] * 0.5
            + L["CloudWatch Logs storage (90-day retention)"] / 3,
        "CloudWatch alarms (8)": 8 * R["cw_alarm_mo"],
        "SSM Parameter Store, standard tier (replaces Secrets Manager)": 0.0,
        "Route 53 (1 public zone + queries)": R["r53_zone_mo"]
            + B["edge_requests"] / 1e6 * R["r53_per_m_queries"],
        "ECR image storage": L["ECR image storage"],
        "S3 (state, static assets, DSR exports)": L["S3 (state, static assets, DSR exports)"],
        "Data transfer out to internet, beyond 100 GB free": 4.0,
    }
    return keep


# ---------------------------------------------------------------- tier 4
def tier4():
    return {
        "Lightsail instance, 2 vCPU / 4 GB / 80 GB / 4 TB transfer": R["lightsail_4gb"],
        "Lightsail managed PostgreSQL, 1 GB bundle": R["lightsail_pg_1gb"],
        "Route 53 (1 public zone + queries)": R["r53_zone_mo"]
            + B["edge_requests"] / 1e6 * R["r53_per_m_queries"],
        "ECR image storage": L["ECR image storage"],
        "S3 (state, static assets, DSR exports)": L["S3 (state, static assets, DSR exports)"],
        "CloudWatch Logs, 30-day IA class": L["CloudWatch Logs ingestion"] * 0.5,
        "SSM Parameter Store, standard tier": 0.0,
    }


def show_delta(title, deltas, subtitle):
    print("=" * 96)
    print("%s  —  %s" % (title, subtitle))
    print("=" * 96)
    print("  %-84s %9.2f" % ("Baseline (scenario B as designed)", BASE))
    run = BASE
    for k, v in deltas:
        run += v
        print("  %-84s %+9.2f" % (k[:84], v))
    print("  " + "-" * 93)
    print("  %-84s %9.2f" % ("AWS run-rate", run))
    print("  %-84s %8.1f%%" % ("reduction vs baseline", 100 * (BASE - run) / BASE))
    print()
    return run


def show_abs(title, items, subtitle):
    print("=" * 96)
    print("%s  —  %s" % (title, subtitle))
    print("=" * 96)
    tot = 0.0
    for k, v in items.items():
        print("  %-84s %9.2f" % (k[:84], v))
        tot += v
    print("  " + "-" * 93)
    print("  %-84s %9.2f" % ("AWS run-rate", tot))
    print("  %-84s %8.1f%%" % ("reduction vs baseline", 100 * (BASE - tot) / BASE))
    print()
    return tot


if __name__ == "__main__":
    t1 = show_delta("TIER 1", tier1(),
                    "same architecture, structural waste removed, full HA on the database")
    t2 = show_delta("TIER 2", tier2(),
                    "single-AZ database with PITR instead of automatic failover")
    t3 = show_abs("TIER 3", tier3(),
                  "one EC2 box running the Compose stack; Fargate/ElastiCache/API Gateway gone")
    t4 = show_abs("TIER 4", tier4(),
                  "Lightsail: flat-rate AWS, everything on one bundle + managed Postgres")

    vf = B["vendor_fixed"]
    sms = B["vendor_var_total"]
    print("=" * 96)
    print("SUMMARY  (vendor subscriptions $%.0f and SMS credit $%.0f are identical in every tier)"
          % (vf, sms))
    print("=" * 96)
    print("  %-30s %10s %10s %12s %12s" % ("", "AWS/mo", "all-in/mo", "AWS/yr", "saved/yr"))
    for name, v in (("Baseline (as designed)", BASE), ("Tier 1", t1), ("Tier 2", t2),
                    ("Tier 3", t3), ("Tier 4", t4)):
        print("  %-30s %10.2f %10.2f %12.2f %12.2f"
              % (name, v, v + vf + sms, v * 12, (BASE - v) * 12))
