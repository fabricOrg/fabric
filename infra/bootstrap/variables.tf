# Inputs for the bootstrap stack. Bucket names are GLOBALLY unique across all of AWS,
# so pick a distinctive prefix. Keep state for staging/prod logically separated by KEY
# (path) inside this one bucket, or use one bucket per environment account if you prefer
# stronger isolation (recommended once prod exists).

variable "region" {
  description = "AWS region (must be the opt-in af-south-1 for our residency posture)."
  type        = string
  default     = "af-south-1"
}

variable "state_bucket_name" {
  description = "Globally-unique S3 bucket name for Terraform state."
  type        = string
  # e.g. "app-tfstate-infra-af-south-1" — change to something unique you own.
}

variable "lock_table_name" {
  description = "DynamoDB table name for Terraform state locking."
  type        = string
  default     = "app-tf-locks"
}
