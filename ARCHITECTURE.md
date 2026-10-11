# Architecture and product boundary

Qingzhou is a local-first desktop shell: call an external capability, receive the result, and save it locally.

## Two entry layers

- **Entry:** `app/src` contains the frontend and `server/app/api.py` exposes the local HTTP API.
- **Adapters:** `server/app/adapters.py` calls external model, workflow, and Agent services.

Local database and UI support modules serve these entry points. They are not a recipe layer, orchestration canvas, plugin system, or Agent framework.

## What belongs upstream

Agent planning, tool execution, workflow orchestration, model hosting, and Agent or Environment creation belong to the provider. Qingzhou connects to those services and presents their status and results. It does not recreate their control plane.

## Product rules

- Product responses must come from real upstream calls; no mock success or demo fallback.
- Upstream errors are shown honestly, including partial results when available.
- Maintenance and CI must not send real inference, upload files, or create Sessions without explicit authorization.
- Long-running tasks should remain observable and must not be stopped by an arbitrary local budget limit.
- Runtime data, credentials, and personal files stay out of source releases.
