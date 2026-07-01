# Platform — Stakeholder Overview Diagram

**Date:** 2026-05-31 · A single "system on a page" for non-technical and technical stakeholders.
Render/export: paste the diagram into <https://mermaid.live> → export PNG/SVG for slides.

---

## The diagram

```mermaid
flowchart TB
    dev["👩‍💻 Developers<br/>(customers)"]
    biz["🧑‍💼 Business users<br/>(customers)"]
    staff["🛠️ Internal staff<br/>(operators)"]

    sso(["🔐 Single Sign-On — WorkOS<br/>one login for every current & future app"])
    dev --> sso
    biz --> sso
    staff --> sso

    subgraph CP["🧭 CONTROL PLANE · Admin — internal only"]
        admin["Configure · Monitor · Govern everything<br/>providers · pricing · limits · audit · health"]
    end
    staff --> admin

    subgraph PLAT["⚙️ THE PLATFORM — one backend, many products"]
        edge["🚪 API Gateway / Edge<br/>authentication · rate-limits · safety checks"]

        api["Public API + SDK"]
        dash["Business Dashboard"]

        subgraph CORE["♻️ Shared core — reused by every product"]
            idn["Identity & Tenants"]
            wal["💰 Wallet & Ledger<br/>multi-currency · accurate billing"]
            bill["Billing & Pricing"]
            misc["API Keys · Webhooks · Events"]
        end

        subgraph PROD["📦 Products"]
            sms["📱 SMS  ◀ first product<br/>send · OTP · campaigns · delivery reports"]
            fut["🔜 Payments · Email · Notifications<br/>future verticals — reuse the same core"]
        end

        integ["🔌 Integrations layer<br/>smart routing · automatic failover · least-cost"]
    end

    sso --> edge
    edge --> api
    edge --> dash
    api --> sms
    dash --> sms
    sms --> idn
    sms --> wal
    sms --> bill
    sms --> integ
    fut -. "plug into the same core" .-> wal

    subgraph VEND["🌍 External vendors — swappable plugins"]
        smsv["SMS gateways<br/>Hubtel · mNotify · Twilio · Termii"]
        payv["Payment providers<br/>Paystack · Flutterwave · Hubtel"]
    end
    integ --> smsv
    integ --> payv

    rec["📨 Message recipients"]
    smsv --> rec

    db[("🗄️ PostgreSQL + Redis<br/>single source of truth")]
    wal --- db
    sms --- db

    admin -. "configures — never in the live path" .-> integ
    admin -. "configures" .-> bill
    admin -. "monitors" .-> sms
    admin -. "monitors" .-> wal

    classDef control fill:#FEF3C7,stroke:#D97706,color:#111827;
    classDef core fill:#DBEAFE,stroke:#2563EB,color:#111827;
    classDef product fill:#DCFCE7,stroke:#16A34A,color:#111827;
    classDef vendor fill:#F3F4F6,stroke:#6B7280,color:#111827;
    classDef gate fill:#EDE9FE,stroke:#7C3AED,color:#111827;
    class admin control;
    class idn,wal,bill,misc core;
    class sms,fut product;
    class smsv,payv vendor;
    class sso,edge gate;
```

---

## How to present it — the story in 5 lines

1. **One login for everyone.** Customers and staff sign in once (SSO); that identity works
   across every app we build now and in the future.
2. **One backend powers many products.** A shared core — wallet, identity, billing — is built
   once and reused. SMS is the first product on top of it.
3. **New products plug in, they aren't rebuilt.** Payments, Email, Notifications later reuse the
   same wallet, login, and billing — so each new product is faster and cheaper to ship, and
   customers get one account, one wallet, one bill.
4. **Vendors are swappable plugins with automatic failover.** We're not locked to any SMS gateway
   or payment provider; if one fails we route around it automatically — higher reliability, lower
   cost, no lock-in.
5. **An admin control plane runs the business.** Staff configure pricing, providers, and limits
   and monitor everything from one place — but it stays out of the live traffic path, so customer
   messages keep flowing even during admin changes.

## Legend (colour coding)
- 🟪 **Purple** — entry points (login, gateway)
- 🟦 **Blue** — shared core reused by all products
- 🟩 **Green** — products (SMS today, more later)
- 🟨 **Amber** — internal admin / control plane
- ⬜ **Grey** — external vendors (pluggable)
- **Dashed lines** — the admin configures/monitors *out of band* (never in the live path)

## The one-sentence pitch
> *One login, one wallet, one backend — SMS today, more products tomorrow — with swappable
> vendors and automatic failover so messages actually arrive, all run from a single admin console.*
