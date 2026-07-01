####################################################################################################
# DEV environment infra (single account, IAM user, eu-west-1).
#
# CONTEXT: this AWS account is DEV-ONLY (no root, no Organizations/Control Tower). Production will be
# a separate account in af-south-1 with the full landing zone (see infra/bootstrap + DEPLOYMENT doc).
#
# STATE: local (terraform.tfstate on disk) — simplest for a single dev account. The S3 backend in
# infra/bootstrap/ is the team/prod pattern; we adopt it when prod/CI arrives.
#
# COST STANCE: only create what we actually need. RDS/ElastiCache/Fargate are deliberately NOT here
# yet — local Docker covers the dev database, and always-on managed services cost money before any
# service uses them. They get added when we first deploy a service to the dev account.
#
# RUN:
#   aws configure --profile app-dev        # one-time: IAM keys + region eu-west-1
#   cd infra/dev && terraform init && terraform apply
####################################################################################################

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  # No backend block → local state. Fine for one dev account; switch to the S3 backend for team/prod.
}

provider "aws" {
  region  = var.region   # eu-west-1 (af-south-1 unavailable here; residency is a PROD concern only)
  profile = var.profile  # the IAM-user profile you set with `aws configure --profile app-dev`
  default_tags {
    tags = {
      Project = "app-platform"
      Env     = "dev"
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
