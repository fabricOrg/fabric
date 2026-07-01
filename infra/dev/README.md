# infra/dev — development environment (eu-west-1)

Single dev AWS account, accessed via an **IAM user**. Local Terraform state. Minimal by design —
grows when we deploy services. (Prod = a separate af-south-1 account with the full landing zone.)

## One-time: configure credentials
```bash
aws configure --profile app-dev
#   AWS Access Key ID     : <your IAM user key>
#   AWS Secret Access Key : <your IAM user secret>
#   Default region name   : eu-west-1
#   Default output format : json

aws sts get-caller-identity --profile app-dev   # confirm it's you
```
> Static IAM keys are acceptable **for this dev account only** (no real customer data). Production
> will use IAM Identity Center SSO with no static keys.

## Apply
```bash
cd infra/dev
terraform init
terraform plan      # review what will be created
terraform apply     # creates the ECR repo (~$0)
```

## What's here now / deferred
- **Now:** ECR image registry (proves the toolchain; needed for the api image soon).
- **Deferred until first service deploy (cost):** VPC, RDS Postgres, the two Redis tiers, Fargate.
  Local Docker (`docker compose up`) covers the database during schema/app development.
