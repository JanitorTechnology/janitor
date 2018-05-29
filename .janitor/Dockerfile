FROM janitortechnology/ubuntu-dev

# Download Janitor's source code and install its dependencies.
RUN git clone --recursive https://github.com/JanitorTechnology/janitor /home/user/janitor \
 && cd /home/user/janitor \
 && npm install
WORKDIR /home/user/janitor

# Add Janitor database with default values for local development.
COPY db.json /home/user/janitor/
RUN sudo chown user:user /home/user/janitor/db.json

# Configure the IDEs to use Janitor's source directory as workspace.
ENV WORKSPACE /home/user/janitor/

# Expose all Janitor server ports.
EXPOSE 8080 8081
