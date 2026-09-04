"""
Fabric production deployment cost model - eu-west-1 (Europe, Ireland)
All rates are AWS/vendor published list prices, USD, checked 2026-09-03.
Sources are recorded in RATES with a confidence flag:
  A = read from AWS's own price feed / pricing page for EU (Ireland)
  B = AWS price feed, value identical in every region read (region-invariant)
  C = third-party aggregator for eu-west-1 (Holori), or another region + known uplift
"""

from dataclasses import dataclass, field

H = 730  # billable hours per month (AWS convention)

# ---------------------------------------------------------------- unit rates
R = {
    # Fargate (A) - eu-west-1 confirmed identical to us-east-1 in the ECS feed
    "fargate_vcpu_hr":        0.04048,
    "fargate_gb_hr":          0.004445,
    "fargate_arm_vcpu_hr":    0.03238,
    "fargate_arm_gb_hr":      0.00356,
    # RDS PostgreSQL single-AZ $/hr (A: rds-postgresql-ondemand feed, EU Ireland)
    "rds_t4g_small":          0.035,
    "rds_t4g_medium":         0.069,
    "rds_t4g_large":          0.138,
    "rds_gp3_gb_mo_multiaz":  0.254,
    "rds_gp3_gb_mo_singleaz": 0.127,
    "rds_proxy_vcpu_hr":      0.018,   # C - needs confirmation
    # ElastiCache Redis node $/hr (C: Holori, eu-west-1)
    "ec_t4g_small":           0.034,
    "ec_t4g_medium":          0.068,
    "ec_backup_gb_mo":        0.085,
    # Networking (C for NAT/cross-AZ, B for EIP and endpoints)
    "nat_hr":                 0.048,
    "nat_gb":                 0.048,
    "eip_hr":                 0.005,
    "xaz_gb_roundtrip":       0.020,
    "vpce_hr_per_az":         0.011,
    # Edge
    "apigw_http_per_req":     1.00 / 1_000_000,
    "cf_req_per_10k":         0.012,
    "cf_gb_eu":               0.085,
    "cf_free_requests":       10_000_000,
    "cf_free_gb":             1024,
    "waf_acl_mo":             5.00,
    "waf_rule_mo":            1.00,
    "waf_per_req":            0.60 / 1_000_000,
    "alb_hr":                 0.0225,
    "alb_lcu_hr":             0.008,
    # Observability / ops
    "cwl_ingest_gb":          0.57,
    "cwl_store_gb_mo":        0.03,
    "cw_alarm_mo":            0.10,
    "cw_metric_mo":           0.30,
    "secret_mo":              0.40,
    "secret_per_10k_calls":   0.05,
    "kms_key_mo":             1.00,
    "kms_per_10k_req":        0.03,
    "r53_zone_mo":            0.50,
    "r53_per_m_queries":      0.40,
    "cloudmap_resource_mo":   0.10,
    "cloudmap_api_per_m":     1.00,
    "dto_gb":                 0.09,
    "ecr_gb_mo":              0.10,
    "s3_gb_mo":               0.023,
    # Vendors
    "grafana_pro_mo":         19.00,
    "sentry_team_mo":         26.00,
    "arkesel_ghs_per_sms":    0.0219,
    "ghs_per_usd":            11.27,
}

RATE_CONFIDENCE = {
    "A": ["fargate_vcpu_hr", "fargate_gb_hr", "fargate_arm_vcpu_hr", "fargate_arm_gb_hr",
          "rds_t4g_small", "rds_t4g_medium", "rds_t4g_large", "rds_gp3_gb_mo_multiaz",
          "rds_gp3_gb_mo_singleaz", "cf_req_per_10k", "waf_acl_mo", "waf_rule_mo",
          "waf_per_req", "secret_mo", "secret_per_10k_calls", "kms_key_mo",
          "kms_per_10k_req", "cloudmap_resource_mo", "ecr_gb_mo"],
    "B": ["eip_hr", "vpce_hr_per_az", "r53_per_m_queries", "apigw_http_per_req"],
    "C": ["rds_proxy_vcpu_hr", "ec_t4g_small", "ec_t4g_medium", "ec_backup_gb_mo",
          "nat_hr", "nat_gb", "xaz_gb_roundtrip", "cf_gb_eu", "alb_hr", "alb_lcu_hr",
          "cwl_ingest_gb", "cwl_store_gb_mo", "cw_alarm_mo", "cw_metric_mo",
          "r53_zone_mo", "s3_gb_mo", "cloudmap_api_per_m", "dto_gb"],
}


@dataclass
class Scenario:
    name: str
    # workload
    tenants: int
    sms_per_month: int
    edge_requests: int          # total requests hitting CloudFront -> API GW
    dto_gb: float               # data out to viewers
    # compute: list of (service, task_count, vcpu, gb)
    tasks: list
    # data stores
    rds_class: str
    rds_storage_gb: int
    rds_proxy: bool
    cache_class: str
    cache_nodes: int
    # network
    nat_gateways: int
    # ops
    log_ingest_gb: float
    alarms: int
    custom_metrics: int
    ci_metrics: int
    secrets: int
    kms_keys: int
    ecr_gb: float
    s3_gb: float
    deploys_per_month: int


LOW = Scenario(
    name="Soft launch",
    tenants=10, sms_per_month=50_000, edge_requests=800_000, dto_gb=40,
    tasks=[("api", 1, 1.0, 2.0), ("worker", 1, 0.5, 1.0),
           ("dashboard", 1, 0.5, 1.0), ("admin-console", 1, 0.5, 1.0)],
    rds_class="rds_t4g_small", rds_storage_gb=50, rds_proxy=False,
    cache_class="ec_t4g_small", cache_nodes=2,
    nat_gateways=2,
    log_ingest_gb=8, alarms=16, custom_metrics=4, ci_metrics=40,
    secrets=19, kms_keys=1, ecr_gb=24, s3_gb=10, deploys_per_month=12,
)

EXPECTED = Scenario(
    name="Modest launch (recommended)",
    tenants=25, sms_per_month=300_000, edge_requests=3_500_000, dto_gb=150,
    tasks=[("api", 2, 1.0, 2.0), ("worker", 1, 0.5, 1.0),
           ("dashboard", 1, 0.5, 1.0), ("admin-console", 1, 0.5, 1.0)],
    rds_class="rds_t4g_medium", rds_storage_gb=100, rds_proxy=True,
    cache_class="ec_t4g_medium", cache_nodes=4,
    nat_gateways=3,
    log_ingest_gb=25, alarms=16, custom_metrics=4, ci_metrics=55,
    secrets=19, kms_keys=2, ecr_gb=24, s3_gb=25, deploys_per_month=20,
)

HIGH = Scenario(
    name="12-month growth",
    tenants=75, sms_per_month=1_500_000, edge_requests=15_000_000, dto_gb=700,
    tasks=[("api", 4, 1.0, 2.0), ("worker", 2, 0.5, 1.0),
           ("dashboard", 2, 0.5, 1.0), ("admin-console", 1, 0.5, 1.0)],
    rds_class="rds_t4g_large", rds_storage_gb=250, rds_proxy=True,
    cache_class="ec_t4g_medium", cache_nodes=4,
    nat_gateways=3,
    log_ingest_gb=90, alarms=20, custom_metrics=12, ci_metrics=85,
    secrets=22, kms_keys=2, ecr_gb=30, s3_gb=100, deploys_per_month=25,
)


def price(s: Scenario) -> dict:
    L = {}  # line item -> monthly USD

    # ---- Fargate compute
    vcpu = sum(n * c for _, n, c, _ in s.tasks)
    mem = sum(n * g for _, n, _, g in s.tasks)
    base = vcpu * H * R["fargate_vcpu_hr"] + mem * H * R["fargate_gb_hr"]
    # rolling deploys run at up to 200% desired count; assume 8 min of doubled
    # capacity per service per deploy, plus one 4-min migration task per deploy
    deploy_task_hours = s.deploys_per_month * (len(s.tasks) * (8 / 60) + 4 / 60)
    deploy_cost = deploy_task_hours * (1.0 * R["fargate_vcpu_hr"] + 2.0 * R["fargate_gb_hr"])
    L["Fargate compute (steady state)"] = base
    L["Fargate compute (deploy + migration overhead)"] = deploy_cost

    # ---- RDS
    L["RDS PostgreSQL instance (Multi-AZ)"] = R[s.rds_class] * 2 * H
    L["RDS gp3 storage (Multi-AZ)"] = s.rds_storage_gb * R["rds_gp3_gb_mo_multiaz"]
    L["RDS backup storage"] = 0.0  # free up to 100% of provisioned storage
    if s.rds_proxy:
        L["RDS Proxy"] = 2 * R["rds_proxy_vcpu_hr"] * H  # 2 vCPU minimum on t-class
    L["RDS enhanced monitoring (CloudWatch)"] = 0.60

    # ---- ElastiCache
    L["ElastiCache Redis nodes"] = s.cache_nodes * R[s.cache_class] * H
    L["ElastiCache snapshot storage"] = 6 * R["ec_backup_gb_mo"]

    # ---- Network
    L["NAT Gateway (hourly)"] = s.nat_gateways * R["nat_hr"] * H
    nat_gb = s.deploys_per_month * 4 * 0.4 + s.log_ingest_gb + s.sms_per_month * 0.000002 + 10
    L["NAT Gateway (data processed)"] = nat_gb * R["nat_gb"]
    L["Elastic IPs"] = s.nat_gateways * R["eip_hr"] * H
    xaz_gb = s.edge_requests * 0.00002 * (2 / 3) + s.edge_requests * 0.000002
    L["Cross-AZ data transfer"] = xaz_gb * R["xaz_gb_roundtrip"]
    # NAT egress to providers and registries leaves the region; first 100 GB/mo
    # is free account-wide
    L["Data transfer out to internet (beyond 100 GB free)"] = max(0, nat_gb - 100) * R["dto_gb"]

    # ---- Edge
    L["API Gateway HTTP API requests"] = s.edge_requests * R["apigw_http_per_req"]
    cf_billable_req = max(0, s.edge_requests - R["cf_free_requests"])
    L["CloudFront requests"] = cf_billable_req / 10_000 * R["cf_req_per_10k"]
    cf_billable_gb = max(0, s.dto_gb - R["cf_free_gb"])
    L["CloudFront data transfer out"] = cf_billable_gb * R["cf_gb_eu"]
    L["AWS WAF (1 web ACL + 4 rules)"] = R["waf_acl_mo"] + 4 * R["waf_rule_mo"]
    L["AWS WAF (requests inspected)"] = s.edge_requests * R["waf_per_req"]

    # ---- Observability / ops
    L["CloudWatch Logs ingestion"] = s.log_ingest_gb * R["cwl_ingest_gb"]
    L["CloudWatch Logs storage (90-day retention)"] = s.log_ingest_gb * 3 * R["cwl_store_gb_mo"]
    L["CloudWatch alarms"] = s.alarms * R["cw_alarm_mo"]
    L["CloudWatch custom metrics"] = s.custom_metrics * R["cw_metric_mo"]
    L["Container Insights (standard, billed as custom metrics)"] = s.ci_metrics * R["cw_metric_mo"]
    task_starts = s.deploys_per_month * len(s.tasks) * 2 + 40
    L["Secrets Manager"] = (s.secrets * R["secret_mo"]
                            + task_starts * s.secrets / 10_000 * R["secret_per_10k_calls"])
    L["KMS customer-managed keys"] = (s.kms_keys * R["kms_key_mo"]
                                      + s.tenants * 4000 / 10_000 * R["kms_per_10k_req"])
    L["Route 53 (1 public + 1 private zone)"] = (2 * R["r53_zone_mo"]
                                                 + s.edge_requests / 1_000_000 * R["r53_per_m_queries"])
    L["Cloud Map registered resources"] = sum(n for _, n, _, _ in s.tasks) * R["cloudmap_resource_mo"]
    # API Gateway resolves the target via DNS, but the SDK/console and health
    # reconciliation still make discovery calls; assume 2 per task per minute
    L["Cloud Map discovery API calls"] = (sum(n for _, n, _, _ in s.tasks) * 2 * 60 * H
                                          / 1_000_000 * R["cloudmap_api_per_m"])
    L["ECR image storage"] = s.ecr_gb * R["ecr_gb_mo"]
    L["S3 (state, static assets, DSR exports)"] = s.s3_gb * R["s3_gb_mo"] + 0.50
    L["SNS alarm notifications"] = 0.0
    L["CloudTrail (first management trail)"] = 0.0
    # Round at source: every subtotal and total downstream is then the exact sum
    # of the figures actually printed.
    return {k: round(v, 2) for k, v in L.items()}


VENDOR_FIXED = {
    "WorkOS (User Management, <1M MAU)": 0.00,
    "Grafana Cloud Pro": R["grafana_pro_mo"],
    "Sentry Team": R["sentry_team_mo"],
    "Infisical (local dev, Free tier)": 0.00,
    "Paystack (no platform fee)": 0.00,
    "Arkesel (no platform fee)": 0.00,
}


def vendor_variable(s: Scenario) -> dict:
    ghs = s.sms_per_month * R["arkesel_ghs_per_sms"]
    return {
        "Arkesel SMS credit (GHS %.0f)" % ghs: ghs / R["ghs_per_usd"],
    }


def report(s: Scenario):
    L = price(s)
    aws = sum(L.values())
    vf = sum(VENDOR_FIXED.values())
    vv = sum(vendor_variable(s).values())
    print("=" * 78)
    print("%s  |  %d tenants  |  %s SMS/mo  |  %s edge req/mo"
          % (s.name, s.tenants, f"{s.sms_per_month:,}", f"{s.edge_requests:,}"))
    print("=" * 78)
    for k, v in sorted(L.items(), key=lambda kv: -kv[1]):
        print("  %-52s %10.2f" % (k, v))
    print("  %-52s %10.2f" % ("AWS SUBTOTAL", aws))
    print("  %-52s %10.2f" % ("Vendor fixed subtotal", vf))
    for k, v in vendor_variable(s).items():
        print("  %-52s %10.2f" % (k, v))
    print("  %-52s %10.2f" % ("TOTAL RUN-RATE (excl. payment fees)", aws + vf + vv))
    print("  %-52s %10.2f" % ("  annualised", (aws + vf + vv) * 12))
    print("  %-52s %10.2f" % ("  AWS per tenant per month", aws / s.tenants))
    print("  %-52s %10.4f" % ("  total per SMS (USD)", (aws + vf + vv) / s.sms_per_month))
    return {"lines": L, "aws": aws, "vendor_fixed": vf, "vendor_var": vv,
            "total": aws + vf + vv}


def optimisations(s: Scenario):
    """Levers are applied SEQUENTIALLY so they never double-count. Each saving is
    measured against the run-rate left by the levers above it."""
    L = price(s)
    out = []

    # Lever 1 - right-size the Redis tier. Do this BEFORE any RI maths, or the
    # reservation discount gets applied to nodes we are about to delete.
    cache_now = s.cache_nodes * R[s.cache_class] * H
    cache_after = cache_now
    if s.cache_nodes >= 4:
        # The queue tier must stay 2-node Multi-AZ (noeviction + BullMQ failover).
        # The cache tier is regenerable, so one smaller node is enough.
        cache_after = 2 * R[s.cache_class] * H + R["ec_t4g_small"] * H
        out.append(("Right-size Redis: queue tier stays 2-node Multi-AZ, cache tier "
                    "drops to one smaller node", cache_now - cache_after))

    # Lever 2 - Graviton on Fargate
    vcpu = sum(n * c for _, n, c, _ in s.tasks)
    mem = sum(n * g for _, n, _, g in s.tasks)
    x86 = vcpu * H * R["fargate_vcpu_hr"] + mem * H * R["fargate_gb_hr"]
    arm = vcpu * H * R["fargate_arm_vcpu_hr"] + mem * H * R["fargate_arm_gb_hr"]
    out.append(("Rebuild images for ARM and run Fargate on Graviton", x86 - arm))

    # Lever 3 - NAT consolidation (hourly + the Elastic IP that goes with it)
    if s.nat_gateways > 1:
        out.append(("Consolidate NAT Gateways from %d to 1 and release 2 Elastic IPs "
                    "(upper bound: some egress becomes billable cross-AZ traffic)"
                    % s.nat_gateways,
                    (s.nat_gateways - 1) * (R["nat_hr"] + R["eip_hr"]) * H))

    # Lever 4 - the free S3 gateway endpoint takes ECR layer pulls off NAT
    ecr_gb = s.deploys_per_month * 4 * 0.4
    out.append(("Add the free S3 gateway VPC endpoint so ECR layer pulls bypass NAT",
                ecr_gb * R["nat_gb"]))

    # Lever 5 - CloudFront caching on static assets
    out.append(("Enable CloudFront caching on dashboard static assets (~40% of "
                "requests stop reaching the origin)",
                (L["API Gateway HTTP API requests"] + L["CloudFront requests"]
                 + L["Cross-AZ data transfer"]) * 0.40))

    # Lever 6 - log retention and log class
    out.append(("Cut CloudWatch log retention 90 to 30 days and move app logs to the "
                "Infrequent Access class",
                L["CloudWatch Logs storage (90-day retention)"] * (2 / 3)
                + L["CloudWatch Logs ingestion"] * 0.50))

    # Lever 7 - Container Insights standard instead of enhanced
    out.append(("Turn Container Insights off and rely on Grafana Cloud, which is "
                "already paid for and carries the same signals",
                L["Container Insights (standard, billed as custom metrics)"]))

    # Lever 8 - commitments, applied to what levers 1-2 leave behind
    out.append(("1-year no-upfront Reserved Instances on RDS (-34%) and on the "
                "right-sized ElastiCache nodes (-32%)",
                L["RDS PostgreSQL instance (Multi-AZ)"] * 0.34 + cache_after * 0.32))
    out.append(("1-year no-upfront Compute Savings Plan on the Graviton Fargate "
                "baseline (-20%)", arm * 0.20))

    print()
    print("=" * 92)
    print("OPTIMISATION LEVERS (sequential, non-overlapping) - %s" % s.name)
    print("=" * 92)
    tot = 0.0
    for k, v in out:
        print("  %-80s %8.2f" % (k[:80], v))
        tot += v
    base = sum(L.values())
    vf = sum(VENDOR_FIXED.values())
    vv = sum(vendor_variable(s).values())
    print("  " + "-" * 89)
    print("  %-80s %8.2f" % ("TOTAL IDENTIFIED MONTHLY SAVING", tot))
    print("  %-80s %8.2f" % ("AWS run-rate before levers", base))
    print("  %-80s %8.2f" % ("AWS run-rate after all levers", base - tot))
    print("  %-80s %7.1f%%" % ("reduction", 100 * tot / base))
    print("  %-80s %8.2f" % ("TOTAL run-rate after levers (incl. vendors + SMS credit)",
                             base - tot + vf + vv))
    print("  %-80s %8.2f" % ("  annualised", (base - tot + vf + vv) * 12))
    return out


def rate_audit():
    """Every rate must appear in exactly one confidence bucket."""
    buckets = {k: set(v) for k, v in RATE_CONFIDENCE.items()}
    allr = set(R) - {"cf_free_requests", "cf_free_gb", "grafana_pro_mo",
                     "sentry_team_mo", "arkesel_ghs_per_sms", "ghs_per_usd"}
    union = set().union(*buckets.values())
    missing = allr - union
    extra = union - allr
    dupes = [k for k in union if sum(k in b for b in buckets.values()) > 1]
    print()
    print("RATE AUDIT  missing=%s  extra=%s  duplicated=%s"
          % (sorted(missing) or "none", sorted(extra) or "none", dupes or "none"))
    assert not missing and not extra and not dupes, "rate confidence table is wrong"


def dump(path="model.json"):
    import json
    payload = {"hours_per_month": H, "rates": R, "confidence": RATE_CONFIDENCE,
               "vendor_fixed": VENDOR_FIXED, "scenarios": []}
    for sc in (LOW, EXPECTED, HIGH):
        L = price(sc)
        aws = sum(L.values())
        vf = sum(VENDOR_FIXED.values())
        vvd = vendor_variable(sc)
        vv = sum(vvd.values())
        payload["scenarios"].append({
            "name": sc.name, "tenants": sc.tenants, "sms": sc.sms_per_month,
            "edge_requests": sc.edge_requests, "dto_gb": sc.dto_gb,
            "tasks": sc.tasks, "rds_class": sc.rds_class,
            "rds_storage_gb": sc.rds_storage_gb, "rds_proxy": sc.rds_proxy,
            "cache_class": sc.cache_class, "cache_nodes": sc.cache_nodes,
            "nat_gateways": sc.nat_gateways, "log_ingest_gb": sc.log_ingest_gb,
            "lines": L, "aws": aws, "vendor_fixed": vf,
            "vendor_variable": vvd, "vendor_var_total": vv,
            "total": aws + vf + vv, "annual": (aws + vf + vv) * 12,
            "aws_per_tenant": aws / sc.tenants,
            "usd_per_sms": (aws + vf + vv) / sc.sms_per_month,
        })
    lev = optimisations(EXPECTED)
    base = sum(price(EXPECTED).values())
    tot = sum(v for _, v in lev)
    payload["levers"] = [{"lever": k, "saving": v} for k, v in lev]
    payload["lever_total"] = tot
    payload["aws_after_levers"] = base - tot
    payload["total_after_levers"] = (base - tot + sum(VENDOR_FIXED.values())
                                     + sum(vendor_variable(EXPECTED).values()))
    with open(path, "w") as f:
        json.dump(payload, f, indent=1)
    print("\nwrote %s" % path)


if __name__ == "__main__":
    for sc in (LOW, EXPECTED, HIGH):
        report(sc)
        print()
    rate_audit()
    dump("/sessions/clever-blissful-newton/mnt/outputs/model.json")
