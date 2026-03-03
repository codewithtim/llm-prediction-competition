import * as pulumi from "@pulumi/pulumi";
import * as digitalocean from "@pulumi/digitalocean";

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

const _firewall = new digitalocean.Firewall("llm-betting", {
  name: "llm-betting-firewall",
  inboundRules: [
    { protocol: "tcp", portRange: "22", sourceAddresses: ["0.0.0.0/0", "::/0"] },
    { protocol: "tcp", portRange: "3000", sourceAddresses: ["0.0.0.0/0", "::/0"] },
    { protocol: "icmp", sourceAddresses: ["0.0.0.0/0", "::/0"] },
  ],
  outboundRules: [
    { protocol: "tcp", portRange: "1-65535", destinationAddresses: ["0.0.0.0/0", "::/0"] },
    { protocol: "udp", portRange: "1-65535", destinationAddresses: ["0.0.0.0/0", "::/0"] },
    { protocol: "icmp", destinationAddresses: ["0.0.0.0/0", "::/0"] },
  ],
  dropletIds: [droplet.id.apply(id => parseInt(id, 10))],
});

const _project = new digitalocean.Project("llm-betting", {
  name: "llm-betting-competition",
  description: "LLM Betting Competition platform",
  purpose: "Web Application",
  environment: "Production",
  resources: [droplet.dropletUrn],
});

export const dropletIp = droplet.ipv4Address;
export const dropletId = droplet.id;
export const dropletUrn = droplet.dropletUrn;
