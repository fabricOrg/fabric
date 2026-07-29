variable "region" {
  description = "Staging region — mirror production in the supported launch region."
  type        = string
  default     = "eu-west-1"
}

variable "profile" {
  description = "Local AWS CLI profile for the staging account (created in the prod org near first release). Not yet configured."
  type        = string
  default     = "app-staging"
}

variable "env" {
  description = "Environment name — used in tags and resource names."
  type        = string
  default     = "staging"
}
