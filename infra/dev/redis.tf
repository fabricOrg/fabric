# ElastiCache Redis for the BullMQ send queue (remediation finding 7, PR B).
#
# BullMQ semantics require noeviction: an evicted job = silently lost work. The default
# parameter group is volatile-lru, so we pin a custom group. Single t4g.micro node — this is the
# TESTING env; staging/prod sizing is a later, human-gated decision. AOF-style durability is not
# available on ElastiCache non-cluster snapshots for micro nodes; acceptable here because every
# money movement is guarded by tx1-before-enqueue + the TTL sweeper (a lost job = a swept refund,
# never a lost charge).

resource "aws_security_group" "redis_queue" {
  name        = "fabric-testing-redis-queue"
  description = "ElastiCache Redis for the BullMQ queue - reachable only from ECS tasks"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "Redis from ECS tasks"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }
}

resource "aws_elasticache_subnet_group" "redis_queue" {
  name       = "fabric-testing-redis-queue"
  subnet_ids = data.aws_subnets.default.ids
}

resource "aws_elasticache_parameter_group" "redis_queue" {
  name   = "fabric-testing-redis-queue-noeviction"
  family = "redis7"

  # BullMQ requirement: never evict jobs under memory pressure — fail writes instead.
  parameter {
    name  = "maxmemory-policy"
    value = "noeviction"
  }
}

resource "aws_elasticache_cluster" "redis_queue" {
  cluster_id           = "fabric-testing-queue"
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = "cache.t4g.micro"
  num_cache_nodes      = 1
  port                 = 6379
  parameter_group_name = aws_elasticache_parameter_group.redis_queue.name
  subnet_group_name    = aws_elasticache_subnet_group.redis_queue.name
  security_group_ids   = [aws_security_group.redis_queue.id]
}

output "redis_queue_endpoint" {
  value       = "redis://${aws_elasticache_cluster.redis_queue.cache_nodes[0].address}:6379"
  description = "REDIS_QUEUE_URL for the api task definition"
}
