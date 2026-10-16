# Logo and Icon Attribution

This bundle (logos.json) contains brand logos and cloud service icons used in draw.yatricloud.com to identify third-party products in diagrams.

## Cloud service icons (full catalogue)

The complete official icon sets are built into `public/cloud-icons/` by `scripts/build-cloud-icons.mjs` from the vendor packages kept in `icons/`. They power the Icons sidebar panel and the AI logo matching. Each source, its download page and its usage terms are recorded in `public/cloud-icons/manifest.json`:

| Provider | Icons | Official page | Terms (summary) |
|---|---|---|---|
| AWS | 303 services, 466 resources, 13 groups | https://aws.amazon.com/architecture/icons/ | Permitted for creating architecture diagrams. |
| Microsoft Azure | 636 services | https://learn.microsoft.com/en-us/azure/architecture/icons/ | Permitted in architectural diagrams, training materials and documentation; do not crop, flip, rotate or distort; label with the service name. |
| Google Cloud | 220 products, 26 categories | https://cloud.google.com/icons | Official product icons for architecture diagrams. |

To update: download the newest packages from those pages into `icons/aws`, `icons/azure` and `icons/gcp`, then run `node scripts/build-cloud-icons.mjs`. The AWS, Azure and Google Cloud entries listed further down are superseded by this catalogue and have been removed from `logos.json`, which now holds brand logos only.

## Trademark notice

All product names, logos, brands and service icons are trademarks or registered trademarks of their respective owners. They are included only to identify the corresponding products and services in user-created diagrams. Their inclusion does not imply endorsement by, affiliation with, or sponsorship from any of the trademark owners. Use them unmodified, label them with the product name, and follow each owner's brand guidelines.

## Simple Icons (brand logos)

- Project: https://github.com/simple-icons/simple-icons (website https://simpleicons.org)
- Package used: npm `simple-icons` version 16.35.0, https://registry.npmjs.org/simple-icons/-/simple-icons-16.35.0.tgz (via `npm pack simple-icons`)
- License: CC0 1.0 Universal for the collection (https://github.com/simple-icons/simple-icons/blob/develop/LICENSE.md).
- Disclaimer: https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md. It notes that not every icon in the collection is necessarily CC0 and asks users to check each icon's license data and the brand's guidelines. Where the package lists a per-icon license, it is stored as `license` on the entry in logos.json.
- Icons whose per-icon license is non-commercial or custom were removed from the bundle: `webpack`. Remaining per-icon licenses (for example MIT, Apache-2.0, CC-BY) are recorded in each entry's `license` field in logos.json.
- Modification: each icon is rendered as its single official path in a 24x24 viewBox, filled with the brand colour from the package data (near-white colours replaced with #1e1e1e for visibility on white).

Included ids (277): `1password`, `airbnb`, `airflow`, `airtable`, `akamai`, `alibaba-cloud`, `anaconda`, `android`, `angular`, `ansible`, `anthropic`, `apache`, `apple`, `arduino`, `argo`, `asana`, `astro`, `atlassian`, `auth0`, `bigquery`, `bitbucket`, `bitcoin`, `bitwarden`, `bootstrap`, `box`, `brevo`, `bun`, `c`, `caddy`, `cassandra`, `chrome`, `circleci`, `claude`, `clerk`, `clickhouse`, `clickup`, `clojure`, `cloudflare`, `cloudflare-pages`, `cloudflare-workers`, `cloudinary`, `cockroachdb`, `confluence`, `consul`, `contentful`, `couchbase`, `cpp`, `css`, `cursor`, `cypress`, `d3`, `dart`, `databricks`, `datadog`, `debian`, `deno`, `digitalocean`, `discord`, `django`, `docker`, `dotnet`, `dropbox`, `druid`, `duckdb`, `elastic`, `elastic-cloud`, `elasticsearch`, `electron`, `elixir`, `envoy`, `erlang`, `ethereum`, `expo`, `express`, `facebook`, `fastapi`, `fastly`, `figma`, `firebase`, `firefox`, `flask`, `flink`, `flutter`, `fly-io`, `framer`, `gatsby`, `git`, `gitea`, `github`, `github-actions`, `github-copilot`, `gitlab`, `gmail`, `go`, `google`, `google-analytics`, `google-cloud`, `google-cloud-storage`, `google-drive`, `google-gemini`, `google-maps`, `google-sheets`, `grafana`, `graphql`, `hadoop`, `haskell`, `helm`, `hetzner`, `html5`, `htmx`, `hubspot`, `hugging-face`, `influxdb`, `instagram`, `ionic`, `ios`, `istio`, `jaeger`, `javascript`, `jenkins`, `jest`, `jira`, `jquery`, `julia`, `jupyter`, `kafka`, `keras`, `keycloak`, `kibana`, `kong`, `kotlin`, `kubernetes`, `langchain`, `langgraph`, `laravel`, `lets-encrypt`, `linear`, `linux`, `lm-studio`, `logstash`, `lua`, `macos`, `mailchimp`, `mapbox`, `mariadb`, `mastercard`, `meta`, `minio`, `miro`, `mistral-ai`, `mongodb`, `mqtt`, `mui`, `mysql`, `n8n`, `nats`, `neo4j`, `neon`, `nestjs`, `netflix`, `netlify`, `new-relic`, `nextjs`, `nginx`, `nodejs`, `notion`, `npm`, `numpy`, `nuxt`, `nvidia`, `okta`, `ollama`, `openapi`, `openjdk`, `openstack`, `openstreetmap`, `opentelemetry`, `ovh`, `pagerduty`, `pandas`, `paypal`, `paytm`, `perl`, `perplexity`, `phonepe`, `php`, `planetscale`, `pnpm`, `podman`, `postgresql`, `postman`, `prisma`, `prometheus`, `proxmox`, `pulsar`, `python`, `pytorch`, `quarkus`, `r`, `rabbitmq`, `railway`, `raspberry-pi`, `razorpay`, `react`, `red-hat`, `reddit`, `redis`, `redux`, `remix`, `render`, `replicate`, `resend`, `ruby`, `ruby-on-rails`, `rust`, `safari`, `sanity`, `sass`, `scala`, `scaleway`, `scikit-learn`, `selenium`, `sentry`, `shadcn-ui`, `shopify`, `snowflake`, `socketio`, `solidity`, `sonarqube`, `spark`, `splunk`, `spotify`, `spring`, `spring-boot`, `sqlalchemy`, `sqlite`, `square`, `storybook`, `strapi`, `stripe`, `supabase`, `svelte`, `swagger`, `swift`, `symfony`, `tailwind-css`, `tauri`, `telegram`, `tensorflow`, `terraform`, `threejs`, `tiktok`, `timescale`, `traefik`, `travisci`, `trello`, `trino`, `twitch`, `typescript`, `uber`, `ubuntu`, `vault`, `vercel`, `visa`, `vite`, `vmware`, `vonage`, `vue`, `vultr`, `webassembly`, `webflow`, `whatsapp`, `wise`, `wix`, `wordpress`, `x`, `yarn`, `youtube`, `zapier`, `zig`, `zoho`, `zoom`

## AWS Architecture Icons

- Page: https://aws.amazon.com/architecture/icons/
- Package: https://d1.awsstatic.com/onedam/marketing-channels/website/public/shared/architecture-icon-release/Icon-package_07312026.5846e92413caa21490223536cc97f1269e44fa92.zip (Architecture-Service-Icons, 48 px SVG)
- Terms: "We allow customers and partners to use these toolkits and assets to create architecture diagrams." (from the page above). Trademark guidelines: https://aws.amazon.com/trademark-guidelines/

Included ids (27): `aws-api-gateway`, `aws-aurora`, `aws-bedrock`, `aws-cloudfront`, `aws-cloudwatch`, `aws-cognito`, `aws-dynamodb`, `aws-ec2`, `aws-ecr`, `aws-ecs`, `aws-eks`, `aws-elasticache`, `aws-elb`, `aws-eventbridge`, `aws-fargate`, `aws-iam`, `aws-kinesis`, `aws-lambda`, `aws-rds`, `aws-route-53`, `aws-s3`, `aws-sagemaker`, `aws-secrets-manager`, `aws-sns`, `aws-sqs`, `aws-step-functions`, `aws-vpc`

## Microsoft Azure Architecture Icons

- Page: https://learn.microsoft.com/en-us/azure/architecture/icons/
- Package: https://arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V24.zip (Azure Public Service Icons V24)
- Terms: "Microsoft permits the use of these icons in architectural diagrams, training materials, or documentation." Microsoft reserves all other rights. Icons must not be cropped, flipped, rotated or distorted, must only represent the Microsoft product they were designed for, and should be labelled with the service name.

Included ids (21): `azure-api-management`, `azure-app-service`, `azure-application-gateway`, `azure-cache-redis`, `azure-container-apps`, `azure-container-registry`, `azure-cosmos-db`, `azure-event-hubs`, `azure-front-door`, `azure-functions`, `azure-key-vault`, `azure-kubernetes-service`, `azure-load-balancer`, `azure-managed-identities`, `azure-monitor`, `azure-openai`, `azure-service-bus`, `azure-sql-database`, `azure-storage-account`, `azure-virtual-machine`, `azure-virtual-network`

## Google Cloud product icons

- Page: https://cloud.google.com/icons
- Packages: https://services.google.com/fh/files/misc/core-products-icons.zip (core product icons, 2025 icon system) and https://services.google.com/fh/files/misc/google-cloud-legacy-icons.zip (legacy console icons, used for services that have no unique core icon)
- Overview guide: https://services.google.com/fh/files/misc/google-cloud-product-icons.pdf
- Terms: the page presents these as the official library of Google Cloud product icons for diagrams and technical documentation; it publishes no separate license text. Google trademarks are subject to Google brand permissions (https://about.google/brand-resource-center/brand-terms/).

Included ids (18): `gcp-alloydb`, `gcp-apigee`, `gcp-bigquery`, `gcp-cloud-armor`, `gcp-cloud-cdn`, `gcp-cloud-functions`, `gcp-cloud-load-balancing`, `gcp-cloud-run`, `gcp-cloud-sql`, `gcp-cloud-storage`, `gcp-compute-engine`, `gcp-firestore`, `gcp-gke`, `gcp-iam`, `gcp-memorystore`, `gcp-pubsub`, `gcp-spanner`, `gcp-vertex-ai`

## Requested brands not available in Simple Icons

These were not in Simple Icons 16.35.0 (typically removed at the trademark owner's request) and were not sourced elsewhere: Amazon Web Services (AWS), Microsoft Azure, Heroku, Oracle, IBM, Java (Oracle mark; OpenJDK included instead), C#, gRPC, Slack, Visual Studio Code, OpenAI, Twilio, SendGrid, Windows, Salesforce, LinkedIn.
