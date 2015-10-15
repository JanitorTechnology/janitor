# Makefile: Tools to help you install the Janitor on Ubuntu/Debian.
# Copyright © 2015 Jan Keromnes. All rights reserved.
# The following code is covered by the AGPLv3 license.


### READ THIS ###

# Install necessary files, npm modules, and docker containers.
install: db https npm daemon ports shipyard localengine welcome

# Delete everything that was created by `make install`.
uninstall: undb unhttps unnpm undaemon unports unlocalengine unshipyard unwelcome


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


### HTTPS CERTIFICATE ###

# Generate self-signed HTTPS credentials.
https: https.crt

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
	rm -f https.key https.csr https.crt


### NPM DEPENDENCIES ###

# Install NPM dependencies.
npm:
	npm install

# Delete NPM dependencies.
unnpm:
	rm -rf node_modules/


### DAEMON ###

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


### SHIPYARD ###

# Install Shipyard (see http://shipyard-project.com/docs/quickstart/).
shipyard:
	sudo docker run -it -d --name shipyard-rethinkdb-data --entrypoint /bin/bash shipyard/rethinkdb -l
	sudo docker run -it -d --name shipyard-rethinkdb --volumes-from shipyard-rethinkdb-data shipyard/rethinkdb
	sudo docker run -it -d --name shipyard -p 127.0.0.1:8080:8080 --link shipyard-rethinkdb:rethinkdb shipyard/shipyard
	sleep 5 && sudo docker start shipyard
	echo "\nWaiting for Docker container \"shipyard\" to start...\n"
	while [ -z "$$(curl -s http://127.0.0.1:8080/auth/login 2>/dev/null)" ] ; do sleep 1 ; done
	$(eval SHIPYARD_PASSWORD := $(shell cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w8 | head -n1))
	SHIPYARD_TOKEN="admin:$$(curl -s -H 'Content-Type: application/json' -X POST -d '{"username":"admin","password":"shipyard"}' http://127.0.0.1:8080/auth/login | sed 's/.*"auth_token":"\([^"]\+\)".*/\1/')" \
	&& curl -s -H "X-Access-Token: $$SHIPYARD_TOKEN" -X POST -d '{"username":"admin","password":"$(SHIPYARD_PASSWORD)"}' http://localhost:8080/account/changepassword \
	&& curl -s -H "X-Access-Token: $$SHIPYARD_TOKEN" -X POST -d '{"description":"janitor key"}' http://localhost:8080/api/servicekeys | sed 's/.*"key":"\([^"]\+\)".*/\1/' > shipyard.apikey
	chmod 400 shipyard.apikey # read by owner
	echo "Shipyard installed! Log in with \"admin\" and the password \"$(SHIPYARD_PASSWORD)\"."

# Uninstall Shipyard.
unshipyard:
	rm -f shipyard.apikey
	sudo docker rm -f shipyard
	sudo docker rm -f shipyard-rethinkdb
	sudo docker rm -f shipyard-rethinkdb-data


### LOCAL DOCKER ENGINE ###

# Use local eth0 address for containers to contact the host.
DOCKER_HOST_IP := $(shell ip a | grep -e "inet.*eth0" | sed 's_.*inet \([^/]\+\)/.*_\1_')

# Fall back on wlan0 if eth0 has no assigned address.
ifeq ($(strip $(DOCKER_HOST_IP)),)
  DOCKER_HOST_IP := $(shell ip a | grep -e "inet.*wlan0" | sed 's_.*inet \([^/]\+\)/.*_\1_')
endif

# Install the local Docker daemon as a Shipyard engine.
localengine: ca.crt docker.crt docker.key shipyard.crt shipyard.key
	sudo cp ca.crt docker.ca
	sudo chown root:root docker.crt docker.key docker.ca
	sudo cp /etc/default/docker /etc/default/docker.old
	echo "\n# Accept secure TLS connections from Shipyard.\nDOCKER_OPTS=\"--tlsverify --tlscacert=$$(pwd)/docker.ca --tlscert=$$(pwd)/docker.crt --tlskey=$$(pwd)/docker.key -H tcp://0.0.0.0:2376 -H unix:///var/run/docker.sock\"" | sudo tee -a /etc/default/docker
	sudo service docker restart && sleep 1
	sudo docker start shipyard-rethinkdb-data
	sudo docker start shipyard-rethinkdb
	sudo docker start shipyard
	sleep 5 && sudo docker start shipyard
	echo "\nWaiting for Docker container \"shipyard\" to start...\n"
	while [ -z "$$(curl -s http://127.0.0.1:8080/auth/login 2>/dev/null)" ] ; do sleep 1 ; done
	curl -s -H 'X-Service-Key: $(shell cat shipyard.apikey)' -X POST -d '{"id":"local-docker","ssl_cert":"$(shell cat shipyard.crt | sed 's_$$_\\n_' | tr -d '\n')","ssl_key":"$(shell cat shipyard.key | sed 's_$$_\\n_' | tr -d '\n')","ca_cert":"$(shell cat ca.crt | sed 's_$$_\\n_' | tr -d '\n')","engine":{"id":"local-docker","addr":"https://$(DOCKER_HOST_IP):2376","cpus":4.0,"memory":4096,"labels":["local"]}}' http://localhost:8080/api/engines

# Create a certificate authority (CA) for Docker and Shipyard.
ca.crt: ca.key
	openssl req -subj '/CN=ca' -new -x509 -days 365 -key ca.key -sha256 -out ca.crt
	chmod 444 ca.crt # read by all

ca.key:
	openssl genrsa -out ca.key 2048
	chmod 400 ca.key # read by owner

# Create a certificate for Docker.
docker.crt: docker.csr ca.crt ca.key
	echo "subjectAltName = IP:$(DOCKER_HOST_IP)" > extfile.cnf
	openssl x509 -req -days 365 -in docker.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out docker.crt -extfile extfile.cnf
	rm -f extfile.cnf docker.csr
	chmod 444 docker.crt # read by all

docker.csr: docker.key
	openssl req -subj '/CN=localhost' -new -sha256 -key docker.key -out docker.csr
	chmod 400 docker.csr # read by owner

docker.key:
	openssl genrsa -out docker.key 2048
	chmod 400 docker.key # read by owner

# Create a certificate for Shipyard.
shipyard.crt: shipyard.csr ca.crt ca.key
	echo 'extendedKeyUsage = clientAuth' > extfile.cnf
	openssl x509 -req -days 365 -in shipyard.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out shipyard.crt -extfile extfile.cnf
	rm -f extfile.cnf shipyard.csr
	chmod 444 shipyard.crt # read by all

shipyard.csr: shipyard.key
	openssl req -subj '/CN=client' -new -key shipyard.key -out shipyard.csr
	chmod 400 shipyard.csr # read by owner

shipyard.key:
	openssl genrsa -out shipyard.key 2048
	chmod 400 shipyard.key # read by owner

# Remove the local Docker daemon from the Shipyard engines.
unlocalengine:
	# TODO Remove the local engine with the Shipyard API.
	sudo mv /etc/default/docker.old /etc/default/docker
	sudo rm -f docker.crt docker.key docker.ca
	rm -f extfile.cnf ca.crt ca.key ca.srl docker.crt docker.csr docker.key shipyard.crt shipyard.csr shipyard.key
	sudo service docker restart && sleep 1


### HELP ###

# Welcome and guide the user.
# TODO Print generated Shipyard admin/password.
welcome:
	@echo
	@echo "To use Shipyard, log in as \"admin\" with the password \"$(SHIPYARD_PASSWORD)\"."
	@echo
	@echo "Janitor was successfully installed. Welcome!"
	@echo "You can now start it with:"
	@echo
	@echo "  node app"
	@echo

# Say good bye to the user.
unwelcome:
	@echo
	@echo "Janitor was successfully uninstalled!"
	@echo

# This is a self-documenting Makefile.
help:
	cat Makefile | less


.PHONY: install uninstall db undb https unhttps npm unnpm daemon undaemon start stop ports unports shipyard unshipyard localengine unlocalengine welcome unwelcome help
