####################################################################################################
# Terraform STATE BACKEND
#
# WHY THIS EXISTS (the chicken-and-egg):
#   Terraform records what it has built in a "state file". For a team, that state must live in shared,
#   locked, versioned storage - not on one laptop. The S3 backend stores state and uses a lockfile
#   in the same bucket so two writers cannot corrupt it.
#   This stack was initially applied with local state to create the bucket. Its state and all
#   environment state now live in separate keys in that bucket.
#
# WHERE TO RUN: the current non-production AWS account.
# HOW:
#   $env:AWS_PROFILE = "app-dev"
#   terraform -chdir=infra/bootstrap init
#   terraform -chdir=infra/bootstrap plan -var="state_bucket_name=..."
####################################################################################################

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  backend "s3" {
    bucket       = "fabric-terraform-state-677035504110-eu-west-1"
    key          = "bootstrap/terraform.tfstate"
    region       = "eu-west-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region  = var.region
  profile = var.profile
  default_tags {
    tags = {
      Project   = "app-platform"
      ManagedBy = "terraform"
      Stack     = "bootstrap"
    }
  }
}

# ---- S3 bucket that stores Terraform state for ALL other stacks ----
resource "aws_s3_bucket" "tf_state" {
  bucket = var.state_bucket_name
  # Safety: prevent accidental deletion of the bucket that holds all our infra state.
  lifecycle {
    prevent_destroy = true
  }
}

# Versioning = every state write keeps history → you can recover from a bad apply.
resource "aws_s3_bucket_versioning" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id
  versioning_configuration { status = "Enabled" }
}

# Encrypt state at rest (it can contain sensitive values) with SSE-KMS.
resource "aws_s3_bucket_server_side_encryption_configuration" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "aws:kms" }
    bucket_key_enabled = true
  }
}

# Block ALL public access — state must never be internet-reachable.
resource "aws_s3_bucket_public_access_block" "tf_state" {
  bucket                  = aws_s3_bucket.tf_state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "tf_state" {
  bucket = aws_s3_bucket.tf_state.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource = [
        aws_s3_bucket.tf_state.arn,
        "${aws_s3_bucket.tf_state.arn}/*",
      ]
      Condition = {
        Bool = {
          "aws:SecureTransport" = "false"
        }
      }
    }]
  })
}

output "state_bucket_name" {
  description = "S3 bucket used by environment backends."
  value       = aws_s3_bucket.tf_state.id
}
