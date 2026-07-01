variable "region" {
  description = "Production region. af-south-1 (Cape Town) for West-Africa proximity and data residency."
  type        = string
  default     = "af-south-1"
}

variable "profile" {
  description = "AWS CLI/SSO profile for the production account (separate account, created near first release). Not yet configured."
  type        = string
  default     = "app-prod"
}

variable "env" {
  description = "Environment name — used in tags and resource names."
  type        = string
  default     = "prod"
}
