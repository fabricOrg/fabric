data "aws_caller_identity" "current" {}

resource "aws_iam_openid_connect_provider" "github_actions" {
  url = "https://token.actions.githubusercontent.com"

  client_id_list = [
    "sts.amazonaws.com",
  ]
}

data "aws_iam_policy_document" "github_testing_assume_role" {
  statement {
    effect = "Allow"

    actions = [
      "sts:AssumeRoleWithWebIdentity",
    ]

    principals {
      type = "Federated"
      identifiers = [
        aws_iam_openid_connect_provider.github_actions.arn,
      ]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        for env in var.github_environments : "repo:${var.github_repository}:environment:${env}"
      ]
    }
  }
}

resource "aws_iam_role" "github_testing_deploy" {
  name                 = "fabric-testing-github-deploy"
  description          = "Least-privilege deployment role for the Fabric testing environment."
  assume_role_policy   = data.aws_iam_policy_document.github_testing_assume_role.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "github_testing_deploy" {
  statement {
    sid       = "EcrAuthentication"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid    = "PushApiImage"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = [
      aws_ecr_repository.api.arn,
      aws_ecr_repository.dashboard.arn,
      aws_ecr_repository.admin_console.arn,
    ]
  }

  statement {
    sid    = "RegisterTaskDefinition"
    effect = "Allow"
    actions = [
      "ecs:DescribeTasks",
      "ecs:DescribeTaskDefinition",
      "ecs:RegisterTaskDefinition",
      "ecs:RunTask",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "DeployTestingService"
    effect = "Allow"
    actions = [
      "ecs:DescribeServices",
      "ecs:UpdateService",
    ]
    resources = [
      "arn:aws:ecs:${var.region}:${data.aws_caller_identity.current.account_id}:service/fabric-testing/fabric-api-testing",
      "arn:aws:ecs:${var.region}:${data.aws_caller_identity.current.account_id}:service/fabric-testing/fabric-dashboard-testing",
      "arn:aws:ecs:${var.region}:${data.aws_caller_identity.current.account_id}:service/fabric-testing/fabric-admin-console-testing",
    ]
  }

  statement {
    sid     = "PassTestingTaskRoles"
    effect  = "Allow"
    actions = ["iam:PassRole"]
    resources = [
      aws_iam_role.api_task.arn,
      aws_iam_role.dashboard_task.arn,
      aws_iam_role.admin_console_task.arn,
      aws_iam_role.ecs_task_execution.arn,
    ]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "github_testing_deploy" {
  name   = "fabric-testing-deploy"
  role   = aws_iam_role.github_testing_deploy.id
  policy = data.aws_iam_policy_document.github_testing_deploy.json
}

output "github_testing_deploy_role_arn" {
  description = "Role assumed by the testing GitHub Environment through OIDC."
  value       = aws_iam_role.github_testing_deploy.arn
}
