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
  value = sort([for subnet in aws_subnet.private : subnet.id])
}

output "ecs_security_group_id" {
  value = aws_security_group.ecs_tasks.id
}

output "testing_waf_web_acl_arn" {
  description = "Global WAF Web ACL associated with all testing CloudFront public edges."
  value       = aws_wafv2_web_acl.testing_edge.arn
}

output "testing_edge_urls" {
  description = "CloudFront public edge URLs protected by the testing WAF Web ACL."
  value = {
    for name, distribution in aws_cloudfront_distribution.testing_edge :
    name => "https://${distribution.domain_name}"
  }
}

output "testing_autoscaled_services" {
  description = "ECS services with Application Auto Scaling enabled."
  value       = sort([for _, service in local.ecs_autoscaled_services : service.name])
}
