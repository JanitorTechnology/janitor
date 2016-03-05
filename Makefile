# Makefile: Tools to help you install the Janitor on Ubuntu/Debian.
# Copyright © 2015 Jan Keromnes. All rights reserved.
# The following code is covered by the AGPL-3.0 license.


### READ THIS ###

# Install necessary files, npm modules, and certificates.
install: db npm ports https client docker welcome

# Delete everything that was created by `make install`.
uninstall: undb unnpm unports unhttps unclient undocker unwelcome


### JSON DATABASE ###

# Set up a simple JSON database.
db: db.json

# Create a clean JSON file.
db.json:
	echo "{}" > db.json
	chmod 600 db.json # read/write by owner

# WARNING: This deletes your data!
undb:
	rm -f db.json


### NPM DEPENDENCIES ###

# Install NPM dependencies.
npm:
	npm install

# Delete NPM dependencies.
unnpm:
	rm -rf node_modules/


### INIT.D DAEMON ###

daemon:
	cat init.d/janitor | sed "s_/path/to/janitor_$$(pwd)_g" | sudo tee /etc/init.d/janitor >/dev/null
	sudo chmod 755 /etc/init.d/janitor # read/write/exec by owner, read/exec by all
	echo "\nYou can now start the Janitor daemon with:\n\n  service janitor start\n"

start: stop
	node app >> janitor.log 2>&1 & [ $$! -ne "0" ] && echo $$! > janitor.pid
	echo "\n[$$(date +%s)] Janitor daemon started (PID $$(cat janitor.pid), LOGS $$(pwd)/janitor.log).\n"

stop:
	if [ -e janitor.pid -a -n "$$(ps h $$(cat janitor.pid))" ] ; then kill $$(cat janitor.pid) && echo "\n[$$(date +%s)] Janitor daemon stopped (PID $$(cat janitor.pid)).\n" ; fi
	rm -f janitor.pid

undaemon:
	sudo rm -f /etc/init.d/janitor


### NON-SUDO WEB PORTS ###

ports:
	cat /etc/rc.local | grep -ve "^exit 0$$" > rc.local
	echo "# Non-sudo web ports for the Janitor." >> rc.local
	echo "iptables -t nat -A PREROUTING -i eth0 -p tcp --dport 80 -j REDIRECT --to-port 1080" >> rc.local
	echo "iptables -t nat -I OUTPUT -o lo -p tcp --dport 80 -j REDIRECT --to-port 1080" >> rc.local
	echo "iptables -t nat -A PREROUTING -i eth0 -p tcp --dport 443 -j REDIRECT --to-port 1443" >> rc.local
	echo "iptables -t nat -I OUTPUT -o lo -p tcp --dport 443 -j REDIRECT --to-port 1443" >> rc.local
	echo "\nexit 0" >> rc.local
	sudo chown root:root rc.local
	sudo chmod 755 rc.local # read/write/exec by owner, read/exec by all
	sudo mv /etc/rc.local /etc/rc.local.old
	sudo mv rc.local /etc/rc.local
	sudo /etc/rc.local

unports:
	rm -f rc.local
	sudo mv /etc/rc.local.old /etc/rc.local


### HTTPS CERTIFICATE ###

# Generate self-signed HTTPS credentials.
https: https.crt https.key

# Create a self-signed SSL certificate.
# Warning: web users will be shown a useless security warning.
https.crt: https.csr https.key
	openssl x509 -req -days 365 -in https.csr -signkey https.key -out https.crt
	chmod 444 https.crt # read by all

# Generate a CSR (Certificate Signing Request) for someone to sign your
# SSL certificate.
https.csr: https.key
	openssl req -new -sha256 -key https.key -out https.csr
	chmod 400 https.csr # read by owner

# Generate an SSL certificate secret key. Never share this!
https.key:
	echo "\nGenerating HTTPS credentials for the main Janitor web app...\n"
	openssl genrsa -out https.key 4096
	chmod 400 https.key # read by owner

# Delete HTTPS credentials.
unhttps:
	rm -f https.crt https.csr https.key


### DOCKER CLIENT CERTIFICATE ###

client: ca.crt client.crt client.key

# Create a certificate authority (CA) for Docker and the Janitor.
ca.crt: ca.key
	openssl req -subj '/CN=ca' -new -x509 -days 365 -key ca.key -sha256 -out ca.crt
	chmod 444 ca.crt # read by all

ca.key:
	openssl genrsa -out ca.key 2048
	chmod 400 ca.key # read by owner

# Create a certificate for the Docker client.
client.crt: client.csr ca.crt ca.key
	echo 'extendedKeyUsage = clientAuth' > extfile.cnf
	openssl x509 -req -days 365 -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out client.crt -extfile extfile.cnf
	rm -f extfile.cnf client.csr
	chmod 444 client.crt # read by all

client.csr: client.key
	openssl req -subj '/CN=client' -new -key client.key -out client.csr
	chmod 400 client.csr # read by owner

client.key:
	openssl genrsa -out client.key 2048
	chmod 400 client.key # read by owner

unclient:
	rm -f extfile.cnf ca.crt ca.key ca.srl client.crt client.csr client.key


### DOCKER HOST CERTIFICATE ###

# If no HOST is defined, default to "localhost".
ifeq ($(strip $(HOST)),)
  HOST := localhost
endif

# Install certificates allowing secure remote access to the local Docker host.
docker: ca.crt docker.crt docker.key
	sudo cp ca.crt docker.ca
	sudo chown root:root docker.crt docker.key docker.ca
	sudo cp /etc/default/docker /etc/default/docker.old
	echo "\n# Accept secure remote access from the Janitor via TLS.\nDOCKER_OPTS=\"--tlsverify --tlscacert=$$(pwd)/docker.ca --tlscert=$$(pwd)/docker.crt --tlskey=$$(pwd)/docker.key -H tcp://0.0.0.0:2376 -H unix:///var/run/docker.sock\"" | sudo tee -a /etc/default/docker
	sudo service docker restart && sleep 1

# Create a certificate for Docker.
docker.crt: docker.csr ca.crt ca.key
	echo "subjectAltName = DNS:localhost,IP:127.0.0.1" > extfile.cnf
	openssl x509 -req -days 365 -in docker.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out docker.crt -extfile extfile.cnf
	rm -f extfile.cnf docker.csr
	chmod 444 docker.crt # read by all

docker.csr: docker.key
	openssl req -subj '/CN=$(HOST)' -new -sha256 -key docker.key -out docker.csr
	chmod 400 docker.csr # read by owner

docker.key:
	openssl genrsa -out docker.key 2048
	chmod 400 docker.key # read by owner

# Delete all the installed certificates.
undocker:
	sudo mv /etc/default/docker.old /etc/default/docker
	sudo rm -f docker.crt docker.key docker.ca
	rm -f extfile.cnf ca.crt docker.csr
	sudo service docker restart && sleep 1


### HELP ###

# Welcome and guide the user.
welcome:
	@echo
	@echo "Janitor was successfully installed. Welcome!"
	@echo "You can now start it with:"
	@echo
	@echo "  node app"
	@echo

# Say goodbye to the user.
unwelcome:
	@echo
	@echo "Janitor was successfully uninstalled!"
	@echo

# This is a self-documented Makefile.
help:
	cat Makefile | less


.PHONY: install uninstall db undb npm unnpm daemon undaemon start stop ports unports https unhttps client unclient docker undocker welcome unwelcome help