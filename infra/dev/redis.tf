# Production-parity Redis tiers for testing:
# - queue: durable-ish BullMQ store, noeviction, Multi-AZ failover, snapshots.
# - cache: separate Redis for rate limits and non-durable cache state.

resource "aws_security_group" "redis_queue" {
  name        = "fabric-testing-redis-queue"
  description = "ElastiCache Redis queue tier - reachable only from ECS tasks"
  vpc_id      = aws_vpc.testing.id

  ingress {
    description     = "Redis from ECS tasks"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group" "redis_cache" {
  name        = "fabric-testing-redis-cache"
  description = "ElastiCache Redis cache/rate-limit tier - reachable only from ECS tasks"
  vpc_id      = aws_vpc.testing.id

  ingress {
    description     = "Redis from ECS tasks"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_elasticache_subnet_group" "redis" {
  name       = "fabric-testing-redis"
  subnet_ids = [for subnet in aws_subnet.private : subnet.id]
}

resource "aws_elasticache_parameter_group" "redis_queue" {
  name   = "fabric-testing-redis-queue-noeviction"
  family = "redis7"

  parameter {
    name  = "maxmemory-policy"
    value = "noeviction"
  }
}

resource "aws_elasticache_parameter_group" "redis_cache" {
  name   = "fabric-testing-redis-cache-lru"
  family = "redis7"

  parameter {
    name  = "maxmemory-policy"
    value = "allkeys-lru"
  }
}

resource "aws_elasticache_replication_group" "redis_queue" {
  replication_group_id       = "fabric-testing-queue"
  description                = "Fabric testing BullMQ queue Redis"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = "cache.t4g.small"
  port                       = 6379
  parameter_group_name       = aws_elasticache_parameter_group.redis_queue.name
  subnet_group_name          = aws_elasticache_subnet_group.redis.name
  security_group_ids         = [aws_security_group.redis_queue.id]
  automatic_failover_enabled = true
  multi_az_enabled           = true
  num_cache_clusters         = 2
  at_rest_encryption_enabled = true
  snapshot_retention_limit   = 7
  snapshot_window            = "01:00-02:00"
}

resource "aws_elasticache_replication_group" "redis_cache" {
  replication_group_id       = "fabric-testing-cache"
  description                = "Fabric testing cache and rate-limit Redis"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = "cache.t4g.small"
  port                       = 6379
  parameter_group_name       = aws_elasticache_parameter_group.redis_cache.name
  subnet_group_name          = aws_elasticache_subnet_group.redis.name
  security_group_ids         = [aws_security_group.redis_cache.id]
  automatic_failover_enabled = true
  multi_az_enabled           = true
  num_cache_clusters         = 2
  at_rest_encryption_enabled = true
  snapshot_retention_limit   = 7
  snapshot_window            = "02:00-03:00"
}

output "redis_queue_endpoint" {
  value       = "redis://${aws_elasticache_replication_group.redis_queue.primary_endpoint_address}:6379"
  description = "REDIS_QUEUE_URL for the api task definition"
}

output "redis_cache_endpoint" {
  value       = "redis://${aws_elasticache_replication_group.redis_cache.primary_endpoint_address}:6379"
  description = "REDIS_CACHE_URL for cache/rate-limit use"
}
