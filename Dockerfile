FROM denoland/deno:2.0.2

WORKDIR /app
VOLUME ["/data"]

COPY package.json /app/package.json
COPY deno.lock /app/deno.lock

RUN deno install --frozen

COPY . /app

RUN deno cache index.ts

CMD ["run", "-A", "index.ts"]
