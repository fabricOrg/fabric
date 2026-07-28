variable "region" {
  description = "Production region. eu-west-1 is the supported launch region."
  type        = string
  default     = "eu-west-1"
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
