####################################################################################################
# TESTING environment infra in the current dev AWS account (eu-west-1).
#
# CONTEXT: this AWS account is non-production (no Organizations/Control Tower). Production will be
# a separate account in af-south-1 with the full landing zone (see infra/bootstrap + DEPLOYMENT doc).
#
# STATE: encrypted and versioned in S3 with a native S3 lockfile.
#
# RUNTIME STANCE: the testing runtime favors production-like behavior over minimum cost. It uses a
# dedicated VPC, private ECS tasks, NAT gateways, Multi-AZ RDS, Redis queue/cache tiers, and alarms.
# Review README.md and docs/TESTING-RUNTIME-RUNBOOK.md before applying this stack.
#
# RUN:
#   aws configure --profile app-dev        # one-time: IAM keys + region eu-west-1
#   $env:AWS_PROFILE = "app-dev"
#   terraform -chdir=infra/dev init
#   terraform -chdir=infra/dev plan
####################################################################################################

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.9"
    }
  }
  backend "s3" {
    bucket       = "fabric-terraform-state-677035504110-eu-west-1"
    key          = "testing/terraform.tfstate"
    region       = "eu-west-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region  = var.region  # eu-west-1 (af-south-1 unavailable here; residency is a PROD concern only)
  profile = var.profile # the IAM-user profile you set with `aws configure --profile app-dev`
  default_tags {
    tags = {
      Project   = "app-platform"
      Env       = "testing"
      ManagedBy = "terraform"
    }
  }
}

provider "aws" {
  alias   = "useast1"
  region  = "us-east-1" # CloudFront-scoped WAF resources are managed from us-east-1.
  profile = var.profile
  default_tags {
    tags = {
      Project   = "app-platform"
      Env       = "testing"
      ManagedBy = "terraform"
    }
  }
}

# ---- ECR: a private registry for our container images ------------------------------------------
# WHY first: it's the cheapest real resource (≈$0 while small), it proves the whole Terraform loop
# (configure → init → plan → apply → real resource), and we'll need it the moment we build the
# NestJS api image. scan_on_push = supply-chain hygiene (our conventions).
resource "aws_ecr_repository" "api" {
  name                 = "app/api"
  image_tag_mutability = "IMMUTABLE" # a tag always points to the same image → reproducible deploys
  image_scanning_configuration {
    scan_on_push = true # flag known CVEs in pushed images automatically
  }
}

# Keep storage cheap: expire old/untagged images instead of accumulating them forever.
resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 7 days"
        selection    = { tagStatus = "untagged", countType = "sinceImagePushed", countUnit = "days", countNumber = 7 }
        action       = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep only the last 20 tagged images"
        selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 20 }
        action       = { type = "expire" }
      }
    ]
  })
}

output "ecr_api_repository_url" {
  description = "Push the api image here (docker push <this>:<tag>)."
  value       = aws_ecr_repository.api.repository_url
}
