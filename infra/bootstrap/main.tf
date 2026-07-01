####################################################################################################
# Terraform STATE BACKEND bootstrap
#
# WHY THIS EXISTS (the chicken-and-egg):
#   Terraform records what it has built in a "state file". For a team, that state must live in shared,
#   locked, versioned storage — not on one laptop. On AWS the standard is an S3 bucket (stores state)
#   + a DynamoDB table (a lock, so two people can't apply at once and corrupt it).
#   But Terraform can't store its state in a bucket that doesn't exist yet. So THIS tiny config
#   creates that bucket+table using LOCAL state (a file on disk), run once. Everything else then
#   uses the bucket as its backend.
#
# WHERE TO RUN: in the **Infrastructure** account (via `aws sso login` first), region af-south-1.
# HOW:
#   terraform init          # uses local state (no backend block here on purpose)
#   terraform apply         # creates the bucket + table
#   # then later stacks put a backend "s3" block pointing at this bucket.
####################################################################################################

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  # NOTE: intentionally NO `backend` block — this bootstrap uses local state to break the
  # chicken-and-egg. Keep the generated terraform.tfstate file safe (commit it to a private,
  # access-controlled location, or store it in the bucket it creates after the first apply).
}

provider "aws" {
  region = var.region
  # af-south-1 is an OPT-IN region: make sure it's enabled in the account and your AWS CLI
  # profile/SSO session targets it. We pin region explicitly so nothing lands elsewhere.
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

# ---- DynamoDB table used as the Terraform state LOCK ----
# When someone runs `apply`, Terraform writes a lock row here; a second concurrent apply waits.
# This prevents two engineers (or two CI runs) from corrupting state by writing simultaneously.
resource "aws_dynamodb_table" "tf_lock" {
  name         = var.lock_table_name
  billing_mode = "PAY_PER_REQUEST" # no capacity planning; cheap for low-frequency locks
  hash_key     = "LockID"
  attribute {
    name = "LockID"
    type = "S"
  }
}
