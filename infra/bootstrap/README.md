# Terraform state backend

This stack created the encrypted, versioned S3 bucket used for Terraform state and native S3
lockfiles. Its own state is now stored under `bootstrap/terraform.tfstate`.

## Dev account

```powershell
$env:AWS_PROFILE = "app-dev"
terraform -chdir=infra/bootstrap init
terraform -chdir=infra/bootstrap plan `
  -var="state_bucket_name=fabric-terraform-state-677035504110-eu-west-1"
```

The environment backend uses:

```hcl
backend "s3" {
  bucket       = "fabric-terraform-state-677035504110-eu-west-1"
  key          = "testing/terraform.tfstate"
  region       = "eu-west-1"
  encrypt      = true
  use_lockfile = true
}
```

S3 lockfiles replace the deprecated DynamoDB locking mechanism. The bucket blocks public access,
denies non-TLS requests, encrypts objects with the AWS-managed KMS key, and retains state versions.

Bootstrapping another AWS account requires a one-time local-backend initialization before adding
that account's backend block. Do not reuse this dev-account bucket for staging or production.
