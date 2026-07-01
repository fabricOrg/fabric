# infra/bootstrap — Terraform state backend

Creates the S3 bucket + DynamoDB lock table that hold Terraform state for every other stack.
**Run once**, in the **Infrastructure** account, after the landing zone (A1) exists.

## Prerequisites
- Terraform ≥ 1.6 and AWS CLI v2 installed.
- Logged in via SSO: `aws sso login --profile app-infra` (profile points at the Infrastructure account, region `af-south-1`).

## Run
```bash
cd infra/bootstrap
terraform init                                   # local state (no backend block here — on purpose)
terraform apply \
  -var="state_bucket_name=app-tfstate-infra-af-south-1"   # must be globally unique
```

## After it applies
Every later stack (VPC, RDS, ECS…) starts with a backend block pointing here, e.g.:
```hcl
terraform {
  backend "s3" {
    bucket         = "app-tfstate-infra-af-south-1"
    key            = "staging/network.tfstate"   # one key per stack+env → isolated state
    region         = "af-south-1"
    dynamodb_table = "app-tf-locks"
    encrypt        = true
  }
}
```

## Why these specific choices
- **S3 for state**: durable, versioned, shared — recover from a bad apply via version history.
- **DynamoDB lock**: prevents two concurrent `apply`s from corrupting state (a classic team footgun).
- **`prevent_destroy` on the bucket**: this bucket is the source of truth for all infra state; losing it is catastrophic, so Terraform refuses to delete it.
- **SSE-KMS + public-access-block**: state can contain secrets; encrypt it and never expose it.
- **No static AWS keys**: auth is via IAM Identity Center SSO (`aws sso login`), so there are no long-lived credentials to leak.
