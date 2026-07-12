locals {
  ecs_autoscaled_services = {
    api = {
      name               = aws_ecs_service.api.name
      min_capacity       = 1
      max_capacity       = 3
      cpu_target         = 60
      memory_target      = 75
      scale_in_cooldown  = 180
      scale_out_cooldown = 60
    }
    dashboard = {
      name               = aws_ecs_service.dashboard.name
      min_capacity       = 1
      max_capacity       = 2
      cpu_target         = 65
      memory_target      = 80
      scale_in_cooldown  = 180
      scale_out_cooldown = 60
    }
    admin_console = {
      name               = aws_ecs_service.admin_console.name
      min_capacity       = 1
      max_capacity       = 2
      cpu_target         = 65
      memory_target      = 80
      scale_in_cooldown  = 180
      scale_out_cooldown = 60
    }
  }
}

resource "aws_appautoscaling_target" "ecs_service" {
  for_each = local.ecs_autoscaled_services

  max_capacity       = each.value.max_capacity
  min_capacity       = each.value.min_capacity
  resource_id        = "service/${aws_ecs_cluster.testing.name}/${each.value.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "ecs_cpu" {
  for_each = local.ecs_autoscaled_services

  name               = "fabric-testing-${replace(each.key, "_", "-")}-cpu-target"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs_service[each.key].resource_id
  scalable_dimension = aws_appautoscaling_target.ecs_service[each.key].scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs_service[each.key].service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = each.value.cpu_target
    scale_in_cooldown  = each.value.scale_in_cooldown
    scale_out_cooldown = each.value.scale_out_cooldown

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

resource "aws_appautoscaling_policy" "ecs_memory" {
  for_each = local.ecs_autoscaled_services

  name               = "fabric-testing-${replace(each.key, "_", "-")}-memory-target"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs_service[each.key].resource_id
  scalable_dimension = aws_appautoscaling_target.ecs_service[each.key].scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs_service[each.key].service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = each.value.memory_target
    scale_in_cooldown  = each.value.scale_in_cooldown
    scale_out_cooldown = each.value.scale_out_cooldown

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
  }
}
