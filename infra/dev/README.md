# Testing environment in the dev AWS account

The current dev AWS account hosts the first deployed environment in `eu-west-1`. The `testing`
branch deploys here; the `dev` branch is an integration-only branch and does not deploy.

## Credentials

```powershell
$env:AWS_PROFILE = "app-dev"
aws sts get-caller-identity
```

Use the bootstrap stack once before initializing this stack. Terraform stores state in the
encrypted, versioned S3 backend and uses a native S3 lockfile.

## Plan and apply

```powershell
$env:AWS_PROFILE = "app-dev"
terraform -chdir=infra/dev init
terraform -chdir=infra/dev plan
terraform -chdir=infra/dev apply
```

The stack currently owns the API ECR repository and the testing GitHub OIDC deployment role. ECS,
RDS, load balancing, secrets, and observability remain deferred until their architecture and
recurring cost are approved.
