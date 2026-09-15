I’d give Cursor a **merged version**, because your instinct is right: my prompt was better for the actual end-state you want, while Claude’s is better at preventing premature landlord/broker backend assumptions.

The right move is:

* **Renter:** full production-grade build now
* **Landlord:** full production-grade frontend shell + calculator + listing-management UX where backend support is safe, but no live applicant/discovery logic that depends on the unresolved interest model
* **Broker:** full production-grade frontend shell grounded in real existing brokerage concepts, but no live payment/BOR-dependent actions yet
* **Shared auth/role architecture:** build the real framework now where existing passwordless auth supports it
* **No fake data**
* **No “demo” language**
* **No pretending blocked features are complete**

So I would give Cursor this:

> # RBIT / dwel.20 Production Web App Master Work Order
>
> We are no longer building a demo shell.
>
> The current renter frontend works, but it is visually too simple and exposes “demo” framing that should not exist in the real product.
>
> Build dwel.20 as one polished responsive web product with three role-aware surfaces:
>
> ```text
> PUBLIC / RENTER
> LANDLORD / PROPERTY MANAGER
> BROKER
> ```
>
> Important distinction:
>
> * RENTER: full implementation against real backend
> * LANDLORD: production-quality frontend + safe live capabilities only; do not implement unresolved applicant/discovery behavior
> * BROKER: production-quality frontend + safe live capabilities only; do not implement BOR/payment behavior that depends on unresolved licensing
>
> Do not use fake data to make incomplete areas look finished.
>
> ---
>
> ## 1. Product-wide rules
>
> Remove all customer-facing wording such as:
>
> * “demo”
> * “sandbox credentials”
> * “how this demo works”
> * engineering/debug explanations
>
> Do not create:
>
> * fake users
> * fake notifications
> * fake counts
> * fake listings
> * fake applications
> * fake matches
> * fake cashback values
> * fake landlord metrics
> * fake broker metrics
>
> If real data does not exist, show a polished empty/setup state.
>
> The old Replit prototype is only a reference for marketplace density and polish. Do not copy its fake Jordan Reed session, fake matches, fake notifications, or unsupported UI controls.
>
> ---
>
> # 2. Shared visual system
>
> Maintain the established dwel.20 identity:
>
> ```text
> accent: #4dfa9f
> forest / mint supporting palette
> Bricolage Grotesque + Figtree
> ```
>
> The UI should feel like a modern real-estate marketplace, not generic SaaS.
>
> Avoid:
>
> * giant empty hero sections
> * endless identical rounded cards
> * excessive dark-green surfaces
> * excessive pills
> * generic dashboard stat tiles everywhere
> * ALL-CAPS tracking-heavy labels
> * developer-oriented explanatory panels
>
> Prioritize:
>
> * strong property photography
> * useful information density
> * editorial layout
> * clear hierarchy
> * strong mobile behavior
> * intentional interaction states
>
> ---
>
> # 3. Public marketplace
>
> Rebuild the marketplace to the quality level suggested by the old Replit prototype, but using only real API data.
>
> Required:
>
> ```text
> /
> /listings
> /listings/:id
> /landlords
> /brokers
> /calculator
> ```
>
> Marketplace must support:
>
> * real listing imagery
> * address/location
> * rent
> * bedrooms
> * bathrooms
> * square footage
> * property type
> * availability where supported
> * incentive/cashback only when backed by actual data
> * loading states
> * useful empty states
> * API-error states
> * pagination/incremental loading
>
> Filters and sorting may only appear if they actually work against real data.
>
> Audit the listing API and safely expose any renter-safe missing fields required for a real listing experience.
>
> Do not create a second listing system.
>
> ---
>
> # 4. Listing media
>
> Support proper real-estate galleries:
>
> * primary image
> * multiple images
> * responsive gallery
> * lazy loading
> * missing-image fallback
> * no broken image states
>
> Use the existing S3/object-store architecture where appropriate.
>
> Do not hardcode stock listing URLs to make the marketplace look populated.
>
> ---
>
> # 5. Renter application
>
> Build the renter experience fully against the existing backend.
>
> Target:
>
> ```text
> browse
> -> listing detail
> -> apply
> -> private application access
> -> consent
> -> screening
> -> application status
> ```
>
> Application UX should look like an actual rental application, not a developer form.
>
> Collect only fields justified by:
>
> * existing application domain
> * Certn requirements
> * currently implemented product requirements
>
> Do not collect unnecessary PII.
>
> Provide:
>
> * validation
> * progress/state
> * clear errors
> * polished save/return behavior
> * responsive forms
>
> ---
>
> # 6. Private application access
>
> Preserve the current secure-link/token architecture.
>
> Customer wording should be something like:
>
> ```text
> Your private application link
> ```
>
> Never expose terms such as bearer token or access token to the renter.
>
> Security requirements:
>
> * no localStorage
> * no sessionStorage unless existing security design explicitly permits it
> * no analytics logging of the secret
> * no console logging
> * no accidental referrer/error-monitor leakage
>
> ---
>
> # 7. Certn behavior
>
> Keep the real Certn integration architecture.
>
> If Certn is configured:
>
> ```text
> consent
> -> submit
> -> processing
> -> status
> ```
>
> If Certn is unavailable:
>
> show polished copy such as:
>
> ```text
> Screening is temporarily unavailable.
> Your application has been saved and no screening request was submitted.
> ```
>
> Do not display internal error codes.
>
> Missing vendor configuration must:
>
> * leave application state unchanged
> * create no fake screening records
> * create no verified result
>
> ---
>
> # 8. Landlord experience
>
> Build the landlord-facing product shell to production visual quality.
>
> Routes:
>
> ```text
> /landlord
> /landlord/listings
> /landlord/listings/new
> /landlord/listings/:id
> /landlord/applications
> /landlord/portfolio
> /landlord/calculator
> ```
>
> Safe functionality that may be wired now:
>
> * landlord sign-in using existing passwordless architecture
> * role-aware routing
> * real listing ownership views if existing schema/RLS supports them
> * create/edit/preview/publish listing if backend CRUD can be implemented without resolving open product decisions
> * portfolio/NOI calculator
>
> Do NOT implement live applicant-review/discovery behavior where doing so requires deciding the unresolved landlord-interest model.
>
> For the application/discovery area:
>
> create **two polished alternate UX concepts**:
>
> ```text
> A. applications tied to a landlord’s listing
> B. discoverable pre-screened renter pool
> ```
>
> These are concept states only.
>
> Do not choose one as final.
>
> Do not wire either to fake backend data.
>
> Report the backend/business decision required before either can become live.
>
> ---
>
> # 9. Landlord listing management
>
> Audit the existing supply schema and RLS.
>
> Determine whether landlord-scoped listing CRUD can safely exist now.
>
> If yes, implement the minimum proper APIs for:
>
> ```text
> create
> edit
> preview
> publish
> unpublish
> status
> ```
>
> Do not duplicate `property`, `unit`, or `listing`.
>
> If listing ownership itself is not sufficiently modeled, stop only that portion and report the exact missing relationship.
>
> ---
>
> # 10. Landlord value calculator
>
> Rename “Landlord math” to something credible:
>
> ```text
> Portfolio Value Calculator
> ```
>
> or
>
> ```text
> NOI Impact Calculator
> ```
>
> Inputs:
>
> * monthly rent
> * unit count
> * turnover frequency
> * existing leasing/broker fee
> * existing concession
> * dwel.20 listing fee
> * tenant incentive %
> * screening credit if applicable
> * cap rate
>
> Make every assumption visible/editable.
>
> Do not call seeded pricing “current terms” unless explicitly approved.
>
> ---
>
> # 11. Broker experience
>
> Build the broker product shell to production visual quality.
>
> Routes:
>
> ```text
> /broker
> /broker/listings
> /broker/leads
> /broker/clients
> /broker/activity
> ```
>
> Audit:
>
> * `broker_balance`
> * prepaid draw-down
> * `fundBrokerBalance`
> * lead records
> * RS-tier classification
> * lead pricing
> * lead purchase
> * ledger relationships
>
> Wire only functionality that is already safe and does not depend on BOR/licensing assumptions.
>
> Do not implement:
>
> * live Connect flows
> * real-money funding
> * payout topology
> * new financial relationships
>
> Build polished empty/disabled states for blocked functionality.
>
> Never fabricate broker balances, leads, or revenue.
>
> Report exactly which pieces require the BOR decision before they can become active.
>
> ---
>
> # 12. Authentication and roles
>
> Public marketplace:
>
> ```text
> no auth
> ```
>
> Renter application:
>
> ```text
> private application link
> ```
>
> Landlord and broker:
>
> ```text
> existing passwordless auth
> ```
>
> Build proper role-aware routing and backend authorization where safely supported.
>
> Frontend hiding is not authorization.
>
> Enforce tenant/role boundaries server-side and through RLS.
>
> Do not create fake logged-in identities.
>
> ---
>
> # 13. Navigation
>
> Public:
>
> ```text
> dwel.20
> Find a home
> For landlords
> For brokers
> Sign in
> ```
>
> Renter/application:
>
> ```text
> Find a home
> My application
> ```
>
> Landlord:
>
> ```text
> Overview
> Listings
> Applications
> Portfolio
> ```
>
> Broker:
>
> ```text
> Overview
> Listings
> Leads
> Clients
> Activity
> ```
>
> Navigation must reflect real identity/state.
>
> ---
>
> # 14. Responsive web
>
> One web application. No native mobile app.
>
> Test:
>
> ```text
> 375
> 430
> 768
> 1024
> 1440+
> ```
>
> Mobile requirements:
>
> * usable search/filter interactions
> * no card overflow
> * intentional collapsed nav
> * comfortable forms
> * usable galleries
> * legible calculator
> * landlord/broker portals still usable
>
> ---
>
> # 15. Accessibility
>
> Production-quality minimum:
>
> * semantic HTML
> * keyboard navigation
> * visible focus
> * accessible form labels
> * alt text
> * correct heading hierarchy
> * sufficient contrast
> * no color-only states
> * associated validation messages
>
> ---
>
> # 16. AWS hosting
>
> Keep hosting entirely in AWS.
>
> Do not introduce Vercel.
>
> Current model:
>
> ```text
> CloudFront
>     -> web frontend
>
> CloudFront API behavior
>     -> ALB
>     -> ECS
> ```
>
> Continue using the existing CloudFront URL until branded DNS is available.
>
> Do not block product work on the domain.
>
> Any infrastructure changes must follow:
>
> ```text
> terraform plan
> -> show exact diff
> -> STOP
> ```
>
> Never apply Terraform without explicit approval.
>
> ---
>
> # 17. Real-data rule
>
> Absolute requirement:
>
> no fabricated:
>
> ```text
> users
> listings
> matches
> applications
> balances
> leads
> notifications
> screening statuses
> cashback
> landlord stats
> broker stats
> ```
>
> Empty state > fake state.
>
> Mock data is allowed only in the explicitly identified landlord alternate-concept screens and broker concept/design exploration, and must never be mixed into live routes or presented as live information.
>
> ---
>
> # 18. Tests
>
> Renter:
>
> * browse
> * detail
> * apply
> * invalid input
> * secure-link routing
> * consent
> * screening unavailable
> * status
>
> Landlord:
>
> * authentication
> * role routing
> * listing ownership/isolation where wired
> * listing CRUD if implemented
>
> Broker:
>
> * authentication
> * role routing
> * tenant isolation for any live broker data
>
> Global:
>
> * responsive critical paths
> * accessibility smoke
> * build
> * backend regression tests after API changes
>
> No unexplained failures.
>
> ---
>
> # 19. Definition of Done
>
> ## Renter
>
> Fully functional:
>
> ```text
> browse
> -> listing
> -> apply
> -> private link
> -> consent
> -> screening when available
> -> status
> ```
>
> ## Landlord
>
> Production-grade interface and navigation.
>
> Real calculator live.
>
> Real listing management may be live where backend support is safe.
>
> Applicant/discovery functionality remains explicitly gated until the landlord-interest decision exists.
>
> ## Broker
>
> Production-grade interface and navigation.
>
> Existing safe broker-domain information may be wired.
>
> BOR/payment-dependent actions remain explicitly gated.
>
> ## Global
>
> * no demo language
> * no fake identities
> * no fake live data
> * polished desktop/mobile
> * AWS-hosted
> * real backend where features are active
>
> ---
>
> # STOP CONDITIONS
>
> Stop only the affected feature if:
>
> 1. landlord-interest behavior must be decided
> 2. BOR/licensing must be decided
> 3. legal/compliance decision is required
> 4. external credentials are unavailable
> 5. schema cannot safely support the requested relationship
> 6. Terraform proposes infrastructure work
>
> Continue building all unaffected surfaces.
>
> Do not stop the entire work order because one role has one blocked feature.
>
> ---
>
> # Final report
>
> Report:
>
> 1. renter frontend changes
> 2. landlord surfaces implemented
> 3. landlord alternate concepts and unresolved decision
> 4. broker surfaces implemented
> 5. broker audit findings
> 6. live vs gated functionality by role
> 7. API changes
> 8. auth/RLS changes
> 9. responsive/accessibility results
> 10. tests/build results
> 11. AWS URL
> 12. exact remaining business/compliance blockers

**That’s the one I’d send.**

It keeps the ambition of the broader prompt, because I agree with you: just making landlord and broker static mockups leaves you too far from the actual product. But it borrows Claude’s discipline where it matters: Cursor gets permission to build the real infrastructure around those roles **without being allowed to invent what the unresolved landlord-interest or BOR decisions mean**.

That gives you the fastest route to a site that looks and feels like the complete dwel.20 platform instead of either a renter-only demo or three fake portals.
