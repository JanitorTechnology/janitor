# Makefile: Tools to help you install Janitor on Ubuntu/Debian.
# Copyright © 2015 Team Janitor. All rights reserved.
# The following code is covered by the AGPL-3.0 license.


### HELP ###

# This is a self-documented Makefile.
help:
	cat Makefile | less


### SET UP NON-SUDO WEB PORTS ###

# If unspecified, auto-detect the primary network interface (e.g. "eth0").
ifeq ($(strip $(PRIMARY_INTERFACE)),)
  PRIMARY_INTERFACE := `route | grep default | awk '{print $$8}'`
endif

ports:
	cat /etc/rc.local | grep -ve "^exit 0$$" > rc.local
	printf "\n# Non-sudo web ports for Janitor.\n" >> rc.local
	printf "iptables -t nat -A PREROUTING -i $(PRIMARY_INTERFACE) -p tcp --dport 80 -j REDIRECT --to-port 1080\n" >> rc.local
	printf "iptables -t nat -I OUTPUT -o lo -p tcp --dport 80 -j REDIRECT --to-port 1080\n" >> rc.local
	printf "iptables -t nat -A PREROUTING -i $(PRIMARY_INTERFACE) -p tcp --dport 443 -j REDIRECT --to-port 1443\n" >> rc.local
	printf "iptables -t nat -I OUTPUT -o lo -p tcp --dport 443 -j REDIRECT --to-port 1443\n" >> rc.local
	printf "\nexit 0\n" >> rc.local
	sudo chown root:root rc.local
	sudo chmod 755 rc.local # read/write/exec by owner, read/exec by all
	sudo mv /etc/rc.local /etc/rc.local.old
	sudo mv rc.local /etc/rc.local
	sudo /etc/rc.local

unports:
	rm -f rc.local
	sudo mv /etc/rc.local.old /etc/rc.local


### ENABLE TLS DOCKER REMOTE API ###

# Install certificates allowing secure remote access to the local Docker host.
# Use the new "daemon.json" file, and work around a configuration conflict:
#   See https://github.com/moby/moby/issues/25471#issuecomment-341912718
docker: docker.ca docker.crt docker.key
	sudo mkdir -p /etc/systemd/system/docker.service.d
	printf "[Service]\nExecStart=\nExecStart=/usr/bin/dockerd\n" | sudo tee /etc/systemd/system/docker.service.d/simple_dockerd.conf # work around "-H fd://" conflict
	sudo systemctl daemon-reload
	sudo cp /etc/docker/daemon.json /etc/docker/daemon.json.old 2>/dev/null; true # backup any prior daemon.json, but ignore errors
	printf "{\n  \"tls\": true,\n  \"tlsverify\": true,\n  \"tlscacert\": \"$$(pwd)/docker.ca\",\n  \"tlscert\": \"$$(pwd)/docker.crt\",\n  \"tlskey\": \"$$(pwd)/docker.key\",\n  \"icc\": false,\n  \"hosts\": [\"tcp://0.0.0.0:2376\", \"unix:///var/run/docker.sock\"]\n}\n" | sudo tee /etc/docker/daemon.json
	sudo service docker restart && sleep 1

# Delete all the installed certificates.
undocker:
	sudo rm -f /etc/systemd/system/docker.service.d/simple_dockerd.conf # remove "-H fd://" conflict work-around
	sudo systemctl daemon-reload
	sudo mv /etc/docker/daemon.json.old /etc/docker/daemon.json 2>/dev/null || sudo rm /etc/docker/daemon.json 2>/dev/null; true # restore any prior daemon.json, but ignore errors
	sudo rm -f docker.crt docker.key docker.ca
	rm -f extfile.cnf ca.crt docker.csr
	sudo service docker restart && sleep 1


.PHONY: help ports unports docker undocker
