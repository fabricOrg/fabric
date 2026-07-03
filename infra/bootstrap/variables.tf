# Inputs for the non-production state backend. Staging and production require separate-account
# buckets rather than additional keys in this bucket.

variable "region" {
  description = "AWS region where the state bucket is created."
  type        = string
  default     = "eu-west-1"
}

variable "profile" {
  description = "Local AWS CLI profile used to bootstrap remote state."
  type        = string
  default     = "app-dev"
}

variable "state_bucket_name" {
  description = "Globally-unique S3 bucket name for Terraform state."
  type        = string
  # e.g. "app-tfstate-infra-af-south-1" — change to something unique you own.
}
