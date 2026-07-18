# Deployment

> Release 0.3.0 benötigt vor dem Rollout einen verifizierten Longhorn-VolumeSnapshot. Die
> Recreate-Strategie muss verhindern, dass zwei Pods gleichzeitig die SQLite-Migration ausführen.
> Bei Migrationsproblemen: Deployment stoppen, PVC aus dem Snapshot wiederherstellen und erst
> danach das 0.2.1-Image setzen. Ein reiner Image-Rollback ist nicht ausreichend.

## Zielumgebung

- Forgejo-Repository und Image: `git.heerlab.com/beasty/qa-council`
- Kubernetes-Namespace: `tools`
- ClusterIP: `10.96.0.178`
- öffentliche Adresse: `https://qa-council.skyway.tools`
- Company-Pangolin-Site: `foolhardy-letheobia-simonii`
- SSO-Rollen: `René` und `Tobias`

Die GitOps-Dateien liegen im separaten Repository `kub-homelab`:

```text
cluster/homelab/apps/tools/qa-council/
config/company-blueprints/qa-council.yaml
```

## Forgejo Actions

Der Workflow `.forgejo/workflows/ci.yaml` besitzt zwei Jobs:

### Quality

- Checkout
- pnpm über Corepack
- Cache des von `pnpm store path` gelieferten Stores mit Betriebssystem und Lockfile-Hash
- reproduzierbare Installation mit Lockfile
- `pnpm check`

### Container

- persönlicher Forgejo-Runner
- gemeinsamer entfernter BuildKit unter `tcp://buildkitd.forgejo-runners.svc.cluster.local:1234`
- zentraler Registry-Login über `beasty/forgejo-ci/actions/registry-login@main`
- Image-Tags `main`, SemVer ohne `v` (zum Beispiel `0.1.0` und `0.1`) sowie Commit-SHA
- Pull Requests bauen, veröffentlichen aber kein Image

Der Registry-Token wird nicht im Projekt gespeichert. Der zentrale Login bezieht ihn zur Laufzeit über die bestehende Forgejo-OIDC-/Infisical-Kette.

## Kubernetes-Komponenten

Der bjw-s-App-Template-HelmRelease erzeugt:

- Deployment `qa-council-main`
- Deployment `qa-council-tika`
- Service `qa-council-main` mit fester ClusterIP `10.96.0.178`
- internen Service `qa-council-tika`
- Longhorn-PVC mit 10 GiB und `ReadWriteOnce`

Die Anwendung verwendet bewusst eine Recreate-Strategie und eine Replik. SQLite und das RWO-Volume sind damit nur an einen aktiven Pod gebunden.

### Ressourcen

| Komponente | Requests | Limits |
|---|---|---|
| QA Council | 100m CPU, 256 MiB | 2 GiB RAM |
| Tika | 100m CPU, 512 MiB | 2 CPU, 3 GiB RAM |

Beide Container laufen ohne privilegierte Rechte und ohne Service-Account-Token. QA Council hat ein schreibgeschütztes Root-Dateisystem und schreibt dauerhaft ausschließlich nach `/data`; für Chromium steht ein flüchtiges `/tmp` bereit. Tika erhält ebenfalls ein eigenes flüchtiges `/tmp`.

## Infisical

Der `InfisicalStaticSecret` liest:

```text
/kubernetes/tools/qa-council-secret
```

aus dem Projekt `Kub-Homelab`, Umgebung `prod`, und erzeugt das Kubernetes Secret `tools/qa-council-secret`. Erwarteter Schlüssel:

```text
OPENROUTER_API_KEY
```

Es werden keine Secret-Werte in Git gespeichert. Codex-OAuth bleibt getrennt als dynamische Datei auf dem PVC.

## Pangolin

`config/company-blueprints/qa-council.yaml` definiert eine öffentliche HTTP-Ressource mit TLS und SSO. Ziel ist `10.96.0.178:3000`, der Healthcheck verwendet `/api/health`.

Die Blueprint-Automation verarbeitet Änderungen unter `config/company-blueprints/**` über die Company-Pangolin-API.

## Validierung vor dem Push

Anwendungsrepository:

```bash
pnpm check
git diff --check
gitleaks git --staged --no-banner --redact
lefthook run pre-commit
```

GitOps-Repository:

```bash
kustomize build cluster/homelab
helm template qa-council bjw-s/app-template \
  --version 5.0.1 \
  --namespace tools \
  -f <(yq '.spec.values' cluster/homelab/apps/tools/qa-council/helmrelease.yaml)
kubectl apply --dry-run=server \
  -f cluster/homelab/apps/tools/qa-council/infisical-sync.yaml
git diff --check
lefthook run pre-commit
```

## Rollout

1. Anwendungsrepository nach Forgejo pushen.
2. Erfolgreichen Quality- und Container-Job abwarten.
3. Den Git-Tag und Forgejo-Release `v0.3.0` erstellen und prüfen, dass
   `git.heerlab.com/beasty/qa-council:0.3.0` verfügbar ist.
4. Den unveränderlichen SemVer-Tag im HelmRelease eintragen und den GitOps-Commit pushen.
5. Flux synchronisieren:

```bash
flux reconcile source git flux-system -n flux-system
flux reconcile kustomization git -n flux-system --with-source
```

6. Laufzeit prüfen:

```bash
kubectl -n tools get helmrelease qa-council
kubectl -n tools get pods,svc,pvc | grep qa-council
kubectl -n tools get infisicalstaticsecret qa-council-secret -o wide
kubectl -n tools logs deploy/qa-council-main --tail=100
curl -fsS https://qa-council.skyway.tools/api/health
```

7. Company-Pangolin-Blueprint-Workflow und SSO-Zugriff prüfen.

## Rollback

- Anwendung: HelmRelease auf einen vorhandenen unveränderlichen SemVer- oder Commit-SHA-Tag setzen.
- GitOps: fehlerhaften Commit mit `git revert` zurücknehmen und Flux erneut reconciliieren.
- Daten: Longhorn-/Velero-Snapshot des PVC wiederherstellen. Datenbank und `settings.key` müssen aus demselben Sicherungsstand stammen.
