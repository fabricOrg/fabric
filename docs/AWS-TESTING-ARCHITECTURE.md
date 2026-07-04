# AWS testing architecture

This diagram describes the provisioned testing environment. It uses logical resource names only;
account IDs, endpoints, subnet IDs, and secret values are deliberately omitted.

## Runtime and network flow

```mermaid
flowchart LR
  client[API clients]

  subgraph aws[AWS testing account]
    apigw[API Gateway HTTP API<br/>TLS, routing, throttling]
    apilogs[CloudWatch API access logs<br/>14-day retention]

    subgraph vpc[Default VPC across three Availability Zones]
      vpclink[API Gateway VPC Link<br/>managed ENIs]
      cloudmap[Cloud Map private namespace<br/>SRV service discovery]

      subgraph ecs_sg[ECS task security group]
        api[ECS Fargate service<br/>NestJS API, 0.25 vCPU / 0.5 GB]
        migration[One-off Fargate migration task<br/>Drizzle migrations and role checks]
      end

      subgraph db_sg[Database security group]
        rds[RDS PostgreSQL 16<br/>encrypted, private, Single-AZ]
      end
    end

    ecr[ECR private repository<br/>immutable tree-hash images]
    secrets[Secrets Manager<br/>DB URLs and ingress tokens]
    applogs[CloudWatch application logs<br/>API and migration streams]
    alarms[CloudWatch alarms<br/>API 5xx, DB CPU, DB storage]
  end

  client -->|HTTPS| apigw
  apigw --> apilogs
  apigw -.->|DiscoverInstances| cloudmap
  apigw -->|private integration| vpclink
  vpclink -->|TCP 3000 only| api
  api -->|register healthy task IP and port| cloudmap
  api -->|TLS PostgreSQL 5432<br/>app_runtime with RLS| rds
  migration -->|TLS PostgreSQL 5432<br/>admin, owner, runtime verification| rds
  ecr -->|image pull| api
  ecr -->|image pull| migration
  secrets -->|runtime DB URL and tokens| api
  secrets -->|admin, owner, runtime DB URLs| migration
  api --> applogs
  migration --> applogs
  apigw --> alarms
  rds --> alarms
```

Only API Gateway is an inbound public entry point. The ECS security group accepts port 3000 only
from the VPC Link security group. RDS is not publicly accessible and accepts port 5432 only from
the ECS task security group.

ECS tasks currently run in default public subnets with public IP addresses for outbound AWS API and
image access. Their security group does not permit public inbound traffic.

## Delivery and control flow

```mermaid
flowchart LR
  developer[Developer]
  github[GitHub repository<br/>dev to testing promotion]
  actions[GitHub Actions<br/>testing environment]

  subgraph aws[AWS testing account]
    resourcegraph[Terraform-managed resource graph]
    oidc[GitHub OIDC provider]
    deployrole[IAM deployment role<br/>short-lived credentials]
    ecr[ECR private repository]
    migration[ECS one-off migration task]
    service[ECS API service]
    rds[RDS PostgreSQL]
    secrets[Secrets Manager]
    logs[CloudWatch Logs]
    state[S3 Terraform state<br/>encrypted, versioned, locked]
  end

  terraform[Terraform operator]

  developer -->|pull request| github
  github -->|testing workflow| actions
  actions -->|OIDC token| oidc
  oidc -->|AssumeRoleWithWebIdentity| deployrole
  deployrole -->|push immutable image| ecr
  deployrole -->|register and run task| migration
  secrets -->|privileged DB URLs| migration
  migration -->|migrate and verify roles| rds
  migration --> logs
  deployrole -->|update after migration succeeds| service
  ecr -->|pull same image| service
  service -->|health and smoke checks| actions

  terraform -->|plan and apply| state
  terraform -->|provision and reconcile| resourcegraph
  resourcegraph -.-> oidc
  resourcegraph -.-> ecr
  resourcegraph -.-> service
  resourcegraph -.-> rds
  resourcegraph -.-> secrets
```

Deployment order is enforced:

1. Build and push an image tagged with the Git tree hash.
2. Ensure a first-deployment rollback image exists.
3. Run the migration task and wait for a successful exit.
4. Register the API task definition and update the ECS service.
5. Wait for container health and ECS stability.
6. Smoke-test `/health` through API Gateway.

## AWS services and roles

| Service or role | Responsibility |
|---|---|
| API Gateway HTTP API | Public HTTPS endpoint, request routing, VPC integration, access logs, and basic throttling. |
| API Gateway VPC Link | Carries API traffic from API Gateway into VPC network interfaces. |
| Cloud Map | Supplies private SRV discovery records for healthy ECS task IPs and ports. |
| ECS cluster and service | Runs the long-lived NestJS API on Fargate and performs circuit-breaker rollback. |
| ECS migration task | Runs schema migrations and verifies the least-privilege database roles before service deployment. |
| ECR | Stores immutable API images keyed by Git tree hash plus the first-deployment rollback tag. |
| RDS PostgreSQL | Stores application data in an encrypted, non-public PostgreSQL instance. |
| Secrets Manager | Stores admin, migration-owner, and runtime database URLs plus operator and webhook tokens. |
| ECS execution role | Allows the ECS agent to pull ECR images, fetch specific secrets, and write container logs. |
| ECS application task role | Runtime identity for future AWS API access; it currently has no additional permissions. |
| GitHub OIDC provider | Exchanges GitHub identity tokens for short-lived AWS credentials without access keys. |
| GitHub deployment role | Pushes images, registers task definitions, runs migrations, updates the testing service, and passes only the two ECS roles. |
| CloudWatch Logs | Retains API, migration, and API Gateway access logs for 14 days. |
| CloudWatch alarms | Detects API 5xx responses, high database CPU, and low database storage. |
| S3 Terraform backend | Stores encrypted, versioned Terraform state with native lockfiles and public access blocked. |

## Current testing limitations

- RDS is Single-AZ with one-day backups and no deletion protection.
- ECS has one fixed task and no autoscaling.
- Default public subnets are used; there are no VPC endpoints or NAT gateway.
- Container Insights is disabled.
- CloudWatch alarms have no notification destination.
- API Gateway has throttling but no WAF or customer identity authorizer.

These choices control testing cost. Staging and production require separate AWS accounts,
purpose-built private networking, stronger database recovery controls, actionable alert delivery,
autoscaling, and production-grade edge protection.
