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

variable "github_environments" {
  description = "GitHub Environments allowed to assume the testing deployment role — one per deployable service (api, dashboard, admin-console) sharing this account."
  type        = list(string)
  default     = ["testing", "testing-dashboard", "testing-admin-console"]
}

variable "testing_sms_provider" {
  description = "SMS provider selected in testing. Use arkesel so testing exercises the same provider path as production."
  type        = string
  default     = "arkesel"

  validation {
    condition     = contains(["fake", "arkesel"], var.testing_sms_provider)
    error_message = "testing_sms_provider must be either fake or arkesel."
  }
}

variable "testing_arkesel_sandbox" {
  description = "Whether testing sends the Arkesel sandbox flag. Set false so testing can validate real SMS delivery."
  type        = bool
  default     = false
}

variable "testing_alarm_email" {
  description = "Optional email subscribed to testing alarm notifications. Leave blank to create the SNS topic without an email subscription."
  type        = string
  default     = ""
}
