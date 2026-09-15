/**
 * application_stack — Aurora, ElastiCache, ALB, ECS on top of account_baseline.
 *
 * Baseline does not tag subnets with Tier=private|public; it uses Name tags
 * like rbit-<env>-private-a. Lookups use those Name tags (no baseline changes).
 *
 * Only one public subnet exists in baseline; ALB requires ≥2 AZs — we add
 * public-b (and route to the existing IGW) without modifying baseline resources.
 */

data "aws_subnets" "private" {
  filter {
    name   = "vpc-id"
    values = [var.vpc_id]
  }
  filter {
    name = "tag:Name"
    values = [
      "rbit-${var.environment}-private-a",
      "rbit-${var.environment}-private-b",
    ]
  }
}

data "aws_subnets" "public_existing" {
  filter {
    name   = "vpc-id"
    values = [var.vpc_id]
  }
  filter {
    name   = "tag:Name"
    values = ["rbit-${var.environment}-public-a"]
  }
}

data "aws_vpc" "main" {
  id = var.vpc_id
}

data "aws_internet_gateway" "existing" {
  filter {
    name   = "attachment.vpc-id"
    values = [var.vpc_id]
  }
}

# Second public subnet for ALB multi-AZ (additive; does not replace baseline public-a).
resource "aws_subnet" "public_b" {
  vpc_id                  = var.vpc_id
  cidr_block              = cidrsubnet(data.aws_vpc.main.cidr_block, 4, 9)
  availability_zone       = "${var.region}b"
  map_public_ip_on_launch = true
  tags = {
    Name        = "rbit-${var.environment}-public-b"
    Environment = var.environment
    ManagedBy   = "terraform"
    Module      = "application_stack"
  }
}

resource "aws_route_table" "public" {
  vpc_id = var.vpc_id
  tags = {
    Name        = "rbit-${var.environment}-public-rt"
    Environment = var.environment
    Module      = "application_stack"
  }
}

resource "aws_route" "public_igw" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = data.aws_internet_gateway.existing.id
}

resource "aws_route_table_association" "public_a" {
  subnet_id      = tolist(data.aws_subnets.public_existing.ids)[0]
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "public_b" {
  subnet_id      = aws_subnet.public_b.id
  route_table_id = aws_route_table.public.id
}

# Reuse baseline NAT — private subnets need outbound internet for ECR, Secrets Manager, etc.
data "aws_nat_gateway" "existing" {
  filter {
    name   = "tag:Name"
    values = ["rbit-${var.environment}-nat"]
  }
  filter {
    name   = "vpc-id"
    values = [var.vpc_id]
  }
}

resource "aws_route_table" "private" {
  vpc_id = var.vpc_id

  tags = {
    Name        = "rbit-${var.environment}-private-rt"
    Environment = var.environment
    Module      = "application_stack"
  }
}

resource "aws_route" "private_nat" {
  route_table_id         = aws_route_table.private.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = data.aws_nat_gateway.existing.id
}

resource "aws_route_table_association" "private" {
  for_each = toset(data.aws_subnets.private.ids)

  subnet_id      = each.value
  route_table_id = aws_route_table.private.id
}

locals {
  public_subnet_ids = concat(
    tolist(data.aws_subnets.public_existing.ids),
    [aws_subnet.public_b.id],
  )
  # Log group /rbit/<env>/api is owned by account_baseline — do not recreate.
  app_log_group = "/rbit/${var.environment}/api"
}
