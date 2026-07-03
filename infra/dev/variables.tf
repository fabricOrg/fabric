variable "region" {
  description = "AWS region for the dev account (af-south-1 is unavailable here; eu-west-1 is closest well-supported to West Africa)."
  type        = string
  default     = "eu-west-1"
}

variable "profile" {
  description = "Local AWS CLI profile (IAM user) used for dev. Set via: aws configure --profile app-dev"
  type        = string
  default     = "app-dev"
}

variable "github_repository" {
  description = "GitHub repository allowed to assume the testing deployment role."
  type        = string
  default     = "fabricOrg/fabric"
}

variable "github_environment" {
  description = "GitHub Environment allowed to assume the testing deployment role."
  type        = string
  default     = "testing"
}
