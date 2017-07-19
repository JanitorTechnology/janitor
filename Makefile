# Makefile: Tools to help you install the Janitor on Ubuntu/Debian.
# Copyright © 2015 Jan Keromnes. All rights reserved.
# The following code is covered by the AGPL-3.0 license.


### HELP ###

# This is a self-documented Makefile.
help:
	cat Makefile | less


### SET UP NON-SUDO WEB PORTS ###

ports:
	cat /etc/rc.local | grep -ve "^exit 0$$" > rc.local
	printf "\n# Non-sudo web ports for the Janitor.\n" >> rc.local
	printf "iptables -t nat -A PREROUTING -i eth0 -p tcp --dport 80 -j REDIRECT --to-port 1080\n" >> rc.local
	printf "iptables -t nat -I OUTPUT -o lo -p tcp --dport 80 -j REDIRECT --to-port 1080\n" >> rc.local
	printf "iptables -t nat -A PREROUTING -i eth0 -p tcp --dport 443 -j REDIRECT --to-port 1443\n" >> rc.local
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
docker: docker.ca docker.crt docker.key
	sudo cp /etc/default/docker /etc/default/docker.old
	printf "\n# Accept secure remote access from the Janitor via TLS.\nDOCKER_OPTS=\"\$$DOCKER_OPTS --tlsverify --tlscacert=$$(pwd)/docker.ca --tlscert=$$(pwd)/docker.crt --tlskey=$$(pwd)/docker.key -H tcp://0.0.0.0:2376 -H unix:///var/run/docker.sock\"\n" | sudo tee -a /etc/default/docker
	printf "\n# Allow containers and images to grow larger than 10G.\nDOCKER_OPTS=\"\$$DOCKER_OPTS --storage-opt dm.basesize=100G\"\n" | sudo tee -a /etc/default/docker
	sudo service docker restart && sleep 1

# Delete all the installed certificates.
undocker:
	sudo mv /etc/default/docker.old /etc/default/docker
	sudo rm -f docker.crt docker.key docker.ca
	rm -f extfile.cnf ca.crt docker.csr
	sudo service docker restart && sleep 1


.PHONY: help ports unports docker undocker
