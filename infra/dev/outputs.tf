output "testing_api_url" {
  description = "Managed HTTPS endpoint for the testing API."
  value       = aws_apigatewayv2_api.testing.api_endpoint
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.testing.name
}

output "ecs_service_name" {
  value = aws_ecs_service.api.name
}

output "ecs_task_definition_family" {
  value = aws_ecs_task_definition.api.family
}

output "ecs_migration_task_definition_family" {
  value = aws_ecs_task_definition.migration.family
}

output "ecs_subnet_ids" {
  value = sort(data.aws_subnets.default.ids)
}

output "ecs_security_group_id" {
  value = aws_security_group.ecs_tasks.id
}
