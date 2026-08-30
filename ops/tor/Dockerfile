FROM alpine:3.22.1

RUN apk add --no-cache tor netcat-openbsd \
    && install -d -o tor -g tor -m 700 /var/lib/tor

COPY --chown=tor:tor torrc /etc/tor/torrc

USER tor
EXPOSE 9050
ENTRYPOINT ["tor", "-f", "/etc/tor/torrc"]
