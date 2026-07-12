data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs              = slice(data.aws_availability_zones.available.names, 0, 3)
  vpc_cidr         = "10.42.0.0/16"
  public_subnets   = { for i, az in local.azs : az => cidrsubnet(local.vpc_cidr, 8, i) }
  private_subnets  = { for i, az in local.azs : az => cidrsubnet(local.vpc_cidr, 8, i + 10) }
  database_subnets = { for i, az in local.azs : az => cidrsubnet(local.vpc_cidr, 8, i + 20) }
}

resource "aws_vpc" "testing" {
  cidr_block           = local.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "fabric-testing"
  }
}

resource "aws_internet_gateway" "testing" {
  vpc_id = aws_vpc.testing.id

  tags = {
    Name = "fabric-testing"
  }
}

resource "aws_subnet" "public" {
  for_each = local.public_subnets

  vpc_id                  = aws_vpc.testing.id
  cidr_block              = each.value
  availability_zone       = each.key
  map_public_ip_on_launch = false

  tags = {
    Name = "fabric-testing-public-${each.key}"
    Tier = "public"
  }
}

resource "aws_subnet" "private" {
  for_each = local.private_subnets

  vpc_id                  = aws_vpc.testing.id
  cidr_block              = each.value
  availability_zone       = each.key
  map_public_ip_on_launch = false

  tags = {
    Name = "fabric-testing-private-${each.key}"
    Tier = "private"
  }
}

resource "aws_subnet" "database" {
  for_each = local.database_subnets

  vpc_id                  = aws_vpc.testing.id
  cidr_block              = each.value
  availability_zone       = each.key
  map_public_ip_on_launch = false

  tags = {
    Name = "fabric-testing-database-${each.key}"
    Tier = "database"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.testing.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.testing.id
  }

  tags = {
    Name = "fabric-testing-public"
  }
}

resource "aws_route_table_association" "public" {
  for_each = aws_subnet.public

  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

resource "aws_eip" "nat" {
  for_each = aws_subnet.public

  domain = "vpc"

  tags = {
    Name = "fabric-testing-nat-${each.key}"
  }
}

resource "aws_nat_gateway" "testing" {
  for_each = aws_subnet.public

  allocation_id = aws_eip.nat[each.key].id
  subnet_id     = each.value.id

  tags = {
    Name = "fabric-testing-${each.key}"
  }

  depends_on = [aws_internet_gateway.testing]
}

resource "aws_route_table" "private" {
  for_each = aws_subnet.private

  vpc_id = aws_vpc.testing.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.testing[each.key].id
  }

  tags = {
    Name = "fabric-testing-private-${each.key}"
  }
}

resource "aws_route_table_association" "private" {
  for_each = aws_subnet.private

  subnet_id      = each.value.id
  route_table_id = aws_route_table.private[each.key].id
}

resource "aws_route_table" "database" {
  vpc_id = aws_vpc.testing.id

  tags = {
    Name = "fabric-testing-database"
  }
}

resource "aws_route_table_association" "database" {
  for_each = aws_subnet.database

  subnet_id      = each.value.id
  route_table_id = aws_route_table.database.id
}

resource "aws_security_group" "database" {
  name        = "fabric-testing-database"
  description = "PostgreSQL access from Fabric testing ECS tasks."
  vpc_id      = aws_vpc.testing.id

  ingress {
    description     = "PostgreSQL from ECS tasks"
    protocol        = "tcp"
    from_port       = 5432
    to_port         = 5432
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group" "ecs_tasks" {
  name        = "fabric-testing-ecs-tasks"
  description = "Ingress from API Gateway VPC Link and outbound dependency access."
  vpc_id      = aws_vpc.testing.id

  ingress {
    description     = "API traffic from API Gateway VPC Link"
    protocol        = "tcp"
    from_port       = 3000
    to_port         = 3000
    security_groups = [aws_security_group.api_gateway_vpc_link.id]
  }

  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group" "api_gateway_vpc_link" {
  name        = "fabric-testing-api-gateway-vpc-link"
  description = "API Gateway private integration network interfaces."
  vpc_id      = aws_vpc.testing.id

  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }

  lifecycle {
    create_before_destroy = true
  }
}
