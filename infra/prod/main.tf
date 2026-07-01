####################################################################################################
# PROD environment — 🔒 DEFINED, NOT PROVISIONED (see README.md).
#
# Intentionally has NO resource blocks yet. Skeleton only, so provisioning later is "uncomment the
# backend + add module calls" rather than "design from scratch". Safe no-op until resources are added
# AND the production account + `app-prod` profile exist.
####################################################################################################

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Remote state — enable at provisioning time (after `infra/bootstrap` creates the bucket + lock table
  # in the prod account). Commented so nobody `init`s against a bucket that doesn't exist yet.
  # backend "s3" {
  #   bucket         = "app-platform-tfstate-prod"
  #   key            = "prod/terraform.tfstate"
  #   region         = "af-south-1"
  #   dynamodb_table = "app-platform-tflock"
  #   encrypt        = true
  # }
}

provider "aws" {
  region  = var.region
  profile = var.profile
  default_tags {
    tags = {
      Project   = "app-platform"
      Env       = var.env
      ManagedBy = "terraform"
    }
  }
}

# ---- Resources go here at provisioning time --------------------------------------------------------
# Compose from ../modules, sized for HA (multi-AZ, ≥2 tasks). Same module set as staging, bigger vars.
