####################################################################################################
# STAGING environment — 🔒 DEFINED, NOT PROVISIONED (see README.md).
#
# Intentionally has NO resource blocks yet. This file establishes the terraform/provider skeleton so
# that provisioning later is "uncomment the backend + add module calls", not "design from scratch".
# `terraform apply` here does nothing until resources are added AND a real `app-staging` account
# profile exists — a deliberately safe no-op.
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
  # in the staging account). Kept commented so nobody `init`s against a bucket that doesn't exist yet.
  # backend "s3" {
  #   bucket         = "app-platform-tfstate-staging"
  #   key            = "staging/terraform.tfstate"
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
# Compose from ../modules, e.g.:
#   module "api_repo"    { source = "../modules/ecr";         name = "app/api" }
#   module "network"     { source = "../modules/network";     env  = var.env }
#   module "api_service" { source = "../modules/ecs-service"; env  = var.env  image = "<promoted image>" }
