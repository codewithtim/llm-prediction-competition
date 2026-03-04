import * as digitalocean from "@pulumi/digitalocean";
import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();

const region = config.get("region") ?? "lon1";
const dropletSize = config.get("dropletSize") ?? "s-1vcpu-1gb";
const sshKeyFingerprint = config.requireSecret("sshKeyFingerprint");

const userData = `#!/bin/bash
set -euo pipefail
apt-get update -y
apt-get install -y docker.io
systemctl enable docker
systemctl start docker
mkdir -p /opt/llm-betting
echo "Bootstrap complete" > /opt/llm-betting/bootstrap.log
`;

const droplet = new digitalocean.Droplet("llm-betting", {
  name: "llm-betting",
  region,
  size: dropletSize,
  image: "ubuntu-24-04-x64",
  sshKeys: [sshKeyFingerprint],
  userData,
});

// Cloudflare IPv4 and IPv6 ranges — only these IPs can reach port 3000.
// See https://www.cloudflare.com/ips/
const cloudflareIpv4 = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
];
const cloudflareIpv6 = [
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

const _firewall = new digitalocean.Firewall("llm-betting", {
  name: "llm-betting-firewall",
  inboundRules: [
    { protocol: "tcp", portRange: "22", sourceAddresses: ["0.0.0.0/0", "::/0"] },
    { protocol: "tcp", portRange: "80", sourceAddresses: [...cloudflareIpv4, ...cloudflareIpv6] },
    { protocol: "tcp", portRange: "443", sourceAddresses: [...cloudflareIpv4, ...cloudflareIpv6] },
    { protocol: "icmp", sourceAddresses: ["0.0.0.0/0", "::/0"] },
  ],
  outboundRules: [
    { protocol: "tcp", portRange: "1-65535", destinationAddresses: ["0.0.0.0/0", "::/0"] },
    { protocol: "udp", portRange: "1-65535", destinationAddresses: ["0.0.0.0/0", "::/0"] },
    { protocol: "icmp", destinationAddresses: ["0.0.0.0/0", "::/0"] },
  ],
  dropletIds: [droplet.id.apply((id) => parseInt(id, 10))],
});

const _project = new digitalocean.Project("llm-betting", {
  name: "llm-betting-competition",
  description: "Opnly.bet",
  purpose: "Web Application",
  environment: "Production",
  resources: [droplet.dropletUrn],
});

export const dropletIp = droplet.ipv4Address;
export const dropletId = droplet.id;
export const dropletUrn = droplet.dropletUrn;
