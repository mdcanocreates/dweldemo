import { Link } from 'react-router-dom';
import { Shell } from '../components/Shell';
import { H, LegalDocLayout, P, Ul } from '../components/LegalDoc';
import { LEGAL_ROUTES } from '../config/legalStatus';

/** About (dwel.20) — no legal gate */
export function AboutPage() {
  return (
    <Shell>
      <LegalDocLayout title="About dwel.20">
        <P>
          dwel.20 is a rental placement marketplace connecting renters, landlords, and licensed
          brokers. We help renters find homes faster, give landlords qualified, verified applicants,
          and give brokers a streamlined way to close placements — with a cashback incentive built
          into every match. dwel.20 is a product of RBIT Financial Inc., based in Austin, Texas.
        </P>
      </LegalDocLayout>
    </Shell>
  );
}

/** FAQs (dwel.20) — no legal gate */
export function FaqsPage() {
  return (
    <Shell>
      <LegalDocLayout title="FAQs">
        <H>Do I have to pay for a background/screening report?</H>
        <P>
          Applicants generally pay a screening fee (processed through our screening partner) to
          apply. Pricing and any state-specific caps are shown before you pay.
        </P>
        <H>How does the cashback work?</H>
        <P>
          Cashback terms are shown on each listing and are paid out according to the{' '}
          <Link to={LEGAL_ROUTES.cashback}>Cash Back Terms &amp; Conditions</Link> and the terms
          displayed at the time of your lease signing.
        </P>
        <H>Are dwel.20 brokers licensed?</H>
        <P>
          Yes — brokers and agents on dwel.20 are verified against their state&apos;s licensing board
          before they can transact on the platform.
        </P>
        <H>How is my personal information used?</H>
        <P>
          See our <Link to={LEGAL_ROUTES.privacy}>Privacy Policy</Link> for full detail on data
          collection, screening-partner sharing, and your rights.
        </P>
      </LegalDocLayout>
    </Shell>
  );
}

/** Terms of Service — project copy. Draft banner stays until LEGAL_APPROVED.terms flips. */
export function TermsPage() {
  return (
    <Shell>
      <LegalDocLayout title="Terms of Service" gate="terms">
        <P>
          <em>Last updated: September 21, 2026</em>
        </P>

        <H>1. Acceptance of These Terms</H>
        <P>
          Welcome to Dwel (the &quot;Service&quot;), operated by RBIT Financial Inc. (&quot;RBIT,&quot;
          &quot;Company,&quot; &quot;we,&quot; &quot;us&quot;). Dwel is RBIT&apos;s tenant placement and
          renter incentive platform — one of two cashback-driven programs RBIT operates, alongside
          Lumis, our residential solar incentive program.
        </P>
        <P>
          These Terms &amp; Conditions (&quot;Terms&quot;) are a binding legal agreement between you
          and RBIT governing your access to and use of the Service. By creating an account,
          submitting an application, or otherwise using the Service, you accept and agree to be
          bound by these Terms, our <Link to={LEGAL_ROUTES.privacy}>Privacy Policy</Link>, our{' '}
          <Link to={LEGAL_ROUTES.cashback}>Cash Back Terms &amp; Conditions</Link>, and any
          supplemental guidelines we post for specific features (collectively, the
          &quot;Guidelines&quot;), which are incorporated by reference.
        </P>
        <P>
          <strong>
            IF YOU DO NOT AGREE TO THESE TERMS, YOU MUST NOT ACCESS OR USE THE SERVICE.
          </strong>
        </P>
        <P>
          RBIT may update these Terms from time to time. Changes take effect when posted, and
          continued use of the Service after changes are posted means you accept the updated Terms.
          For material changes, we may require your affirmative acceptance (e.g., an &quot;I
          Agree&quot; checkbox) before you can continue using the Service. Certain features may
          carry additional Supplemental Terms, which control over these Terms only as to that
          feature.
        </P>

        <H>2. Eligibility, Geographic Scope &amp; Your Account</H>
        <P>
          The Service is intended for users who are 18 years of age or older and legally capable of
          entering into a binding contract. By using the Service, you represent that you meet these
          requirements.
        </P>
        <P>
          RBIT Financial Inc. is a Delaware corporation headquartered in Austin, Texas, and the
          Service is offered for use by persons located in the United States. We make no claim that
          Dwel or Lumis is appropriate or available outside the U.S., or outside the specific
          states/markets where a given incentive program currently operates. If you access the
          Service from elsewhere, you do so at your own risk and are responsible for compliance with
          local law.
        </P>
        <P>
          <strong>Accounts.</strong> To use certain features (e.g., applying for a Dwel renter
          incentive or a Lumis solar incentive), you must register for an account and provide true,
          accurate, current, and complete information, which you agree to keep up to date. You are
          responsible for maintaining control of the email account associated with your login and
          for all activity under your account. Notify us immediately at{' '}
          <a href="mailto:info@rbitfinancial.com">info@rbitfinancial.com</a> if you suspect
          unauthorized use. We may disable any account, at any time, if we reasonably believe you
          have violated these Terms.
        </P>
        <P>
          Brokers and agents must additionally supply a valid state real estate license number and
          issuing state at signup, verified against the relevant state licensing board (e.g., TREC
          in Texas) before their account can transact.
        </P>

        <H>3. Communications Consent</H>
        <P>
          By providing your phone number, you agree that RBIT and our business partners — including
          participating landlords and property managers (Dwel) and solar installers (Lumis) — may
          contact you by autodialed, pre-recorded, or artificial-voice calls and text messages
          regarding your account, application status, cashback and incentive offers, and related
          marketing — even if your number is on a do-not-call list. Consent is not a condition of
          using the Service. Message and data rates may apply; contact your carrier with plan
          questions.
        </P>
        <P>
          You may opt out of texts from RBIT at any time by replying STOP; we&apos;ll confirm your
          opt-out by text. To opt back in, reply START or email{' '}
          <a href="mailto:info@rbitfinancial.com">info@rbitfinancial.com</a>. Reply HELP for
          assistance. To stop communications from a specific landlord or partner, you must contact
          that partner directly. If your phone number changes, update your account promptly so
          messages aren&apos;t sent to whoever acquires your old number.
        </P>

        <H>3A. Tenant Screening &amp; Consumer Reports</H>
        <P>
          As part of certain applications, Dwel may require you to authorize a background and/or
          credit check performed by our third-party consumer reporting agency, Certn
          (&quot;Screening Partner&quot;). The screening fee is disclosed to the applicant before
          payment (approximately $29 standard, capped at $20 for New York applicants per RPL
          §238-a) and is paid directly by the applicant, not RBIT.
        </P>
        <P>
          By initiating a screening request, you authorize RBIT and Certn to obtain a consumer
          report about you, which may include a criminal background check, eviction history, credit
          report, and identity verification, for the purpose of evaluating your rental application.
          This authorization remains valid for as long as you maintain an active account, unless you
          revoke it in writing to info@rbitfinancial.com.
        </P>
        <P>
          If RBIT or a Landlord takes adverse action against you (such as denying your application)
          based in whole or in part on information contained in a consumer report, you will first
          receive a pre-adverse action notice, a copy of the report, and a summary of your rights
          under the FCRA. If the decision is finalized, you will receive a follow-up adverse action
          notice no sooner than five (5) business days after the pre-adverse notice. You have the
          right to dispute the accuracy or completeness of any information in your consumer report
          directly with Certn, who will investigate and correct any verified inaccuracies within the
          timeframe required by the FCRA.
        </P>
        <P>
          New York applicants — per RPL §238-a, you may instead upload your own screening report
          obtained within the last 30 days in lieu of purchasing a new one through Dwel; freshness
          is evaluated at the time you click to express interest.
        </P>

        <H>4. Intellectual Property &amp; Trademarks</H>
        <P>
          The Service and everything on it — listings, program terms, software, text, design, and
          all other content (&quot;RBIT Materials&quot;) — are owned by RBIT, our licensors, or our
          business partners, and are protected by copyright, trademark, trade secret, and other
          laws. These Terms grant you a limited license for personal, non-commercial use only; you
          may not copy, sell, license, distribute, or create derivative works from RBIT Materials
          except as your browser or device automatically and temporarily caches for normal viewing.
        </P>
        <P>
          &quot;RBIT,&quot; &quot;Dwel,&quot; &quot;Lumis,&quot; and our logos are trademarks of RBIT
          Financial Inc. You may not use them without our prior written consent. If you submit
          feedback or suggestions about the Service, you assign that feedback to RBIT at no charge
          to us.
        </P>

        <H>5. Prohibited Uses</H>
        <P>You agree not to:</P>
        <Ul>
          <li>
            Use the Service for any unlawful purpose, or in a way that violates any applicable law
            or regulation.
          </li>
          <li>
            Submit false, misleading, or fraudulent information in a Dwel or Lumis application
            (e.g., regarding tenancy, eligibility, or a property&apos;s solar suitability).
          </li>
          <li>
            Submit false, fraudulent, or unverifiable real estate license information
            (Brokers/agents) or false ownership/verification documents (Landlords).
          </li>
          <li>
            Impersonate RBIT, an RBIT employee, a landlord, an installer, or any other user.
          </li>
          <li>
            Harass, defraud, or collect personal information about other users without consent.
          </li>
          <li>
            Interfere with, disable, or circumvent any security or anti-fraud feature of the
            Service.
          </li>
          <li>Attempt unauthorized access to the Service or any connected system.</li>
          <li>
            Scrape, crawl, or use automated tools to access or copy the Service without our prior
            written consent.
          </li>
          <li>Introduce malware, or attempt a denial-of-service or similar attack.</li>
          <li>
            Reverse-engineer or decompile the Service, except as expressly permitted by law.
          </li>
        </Ul>
        <P>
          Violation of this section may result in suspension or termination of your account,
          forfeiture of pending or future cashback, and forfeiture of screening eligibility
          (including loss of access to a screening report obtained through the Service). Screening
          fees are non-refundable once a report has been generated, including where your account is
          later suspended or terminated for a violation of these Terms.
        </P>

        <H>6. Third-Party Content &amp; Partners</H>
        <P>
          Using the Service exposes you to content and offers from third parties RBIT does not
          control — for example, participating landlords and property managers (Dwel), Certn (our
          Screening Partner / consumer reporting agency), solar installers and utility/incentive
          programs (Lumis), and other service providers (&quot;Non-RBIT Content&quot;). RBIT is not
          responsible for the accuracy, legality, or quality of Non-RBIT Content, any transaction
          you enter into with a third party, or any dispute you have with one. We do not guarantee
          that a listed property, incentive amount, or solar quote is the best available,
          affordable, or accurate, and ordering of any listings or offers may reflect location,
          your preferences, availability, and fees paid by partners.
        </P>
        <P>
          We may, but are not obligated to, monitor or remove Non-RBIT Content at our discretion.
          You waive any claim against RBIT arising from your dealings with landlords, installers,
          the Screening Partner, or other third parties connected through the Service.
        </P>

        <H>7. Disclaimers &amp; Limitation of Liability</H>
        <P>
          <strong>As-is.</strong> THE SERVICE, RBIT MATERIALS, AND NON-RBIT CONTENT ARE PROVIDED
          &quot;AS IS&quot; AND &quot;AS AVAILABLE,&quot; WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR
          IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND
          NON-INFRINGEMENT. RBIT DOES NOT WARRANT THAT CASHBACK, INCENTIVE AMOUNTS, OR SOLAR
          SAVINGS ESTIMATES WILL BE ACCURATE, AVAILABLE, OR GUARANTEED, AND ANY SUCH AMOUNTS ARE
          SUBJECT TO THE SPECIFIC PROGRAM TERMS, PARTNER APPROVAL, AND ELIGIBILITY REQUIREMENTS
          DISCLOSED AT THE TIME OF YOUR APPLICATION. RBIT DOES NOT WARRANT THE ACCURACY OR
          COMPLETENESS OF ANY CONSUMER REPORT OBTAINED THROUGH THE SERVICE; SUCH REPORTS ARE
          PREPARED BY OUR SCREENING PARTNER AND ANY DISPUTE REGARDING THEIR CONTENT MUST BE
          DIRECTED TO THE SCREENING PARTNER AS DESCRIBED IN SECTION 3A.
        </P>
        <P>
          <strong>Limitation of liability.</strong> TO THE MAXIMUM EXTENT PERMITTED BY LAW,
          RBIT&apos;S TOTAL AGGREGATE LIABILITY TO YOU UNDER THESE TERMS WILL NOT EXCEED THE
          GREATER OF (A) THE CASHBACK OR INCENTIVE AMOUNT AT ISSUE, OR (B) ONE HUNDRED DOLLARS
          ($100). RBIT WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, CONSEQUENTIAL, OR
          EXEMPLARY DAMAGES, EVEN IF ADVISED OF THE POSSIBILITY. WHERE LAW DOES NOT PERMIT THIS
          LIMITATION, IT APPLIES ONLY TO THE EXTENT PERMITTED.
        </P>

        <H>8. Dispute Resolution &amp; Arbitration</H>
        <P>
          <strong>Read carefully.</strong> This section requires you and RBIT to resolve most
          disputes through individual binding arbitration rather than in court, and waives your
          right to a jury trial and to participate in a class action.
        </P>
        <P>
          <strong>Informal resolution first.</strong> Before filing any claim, contact us at{' '}
          <a href="mailto:info@rbitfinancial.com">info@rbitfinancial.com</a> so we can try to
          resolve the issue informally. If unresolved within 15 days, either party may proceed to
          arbitration.
        </P>
        <P>
          <strong>Agreement to arbitrate.</strong> Except for small-claims-court-eligible matters
          or actions to protect intellectual property or prevent misuse of the Service (which may
          be brought in court in Travis County, Texas), you and RBIT agree to resolve Disputes by
          binding arbitration under the Federal Arbitration Act, administered by the American
          Arbitration Association (AAA) under its consumer arbitration rules, in Austin, Texas or
          the U.S. county where you reside, at your election.
        </P>
        <P>
          <strong>No class actions.</strong> Arbitration will proceed only on an individual basis.
          YOU AND RBIT EACH WAIVE THE RIGHT TO A JURY TRIAL AND TO PARTICIPATE IN A CLASS,
          COLLECTIVE, OR REPRESENTATIVE ACTION.
        </P>
        <P>
          <strong>Time limit.</strong> Any claim must be brought within one year after it accrues,
          or it is permanently barred.
        </P>
        <P>
          <strong>Opt-out.</strong> New users may reject this arbitration provision by mailing
          written notice (name, email, a statement rejecting arbitration, and signature) to the
          mailing address in Section 12 below within 30 days of first accepting these Terms. The
          rest of these Terms remain in effect if you opt out.
        </P>

        <H>9. Indemnification</H>
        <P>
          You agree to indemnify, defend, and hold harmless RBIT, its affiliates, and their
          officers, directors, employees, and agents from any third-party claim, loss, or expense
          (including reasonable attorneys&apos; fees) arising from (i) your misuse of the Service,
          (ii) your violation of these Terms, or (iii) your violation of another person&apos;s or
          entity&apos;s rights. RBIT may assume exclusive control of the defense of any matter
          subject to indemnification, and you agree to cooperate with that defense; you may not
          settle such a matter without our prior written consent.
        </P>

        <H>10. Termination</H>
        <P>
          RBIT may suspend, disable, or terminate your account or access to the Service at any
          time, at our discretion, including for a violation of these Terms, without liability to
          you. You may close your account and stop using the Service at any time. Upon termination,
          any license granted to you under these Terms ends, though pending cashback obligations
          already earned under a program&apos;s specific terms will be handled per that
          program&apos;s terms unless forfeited under Section 5.
        </P>

        <H>11. Miscellaneous</H>
        <P>
          <strong>Entire agreement.</strong> These Terms, the{' '}
          <Link to={LEGAL_ROUTES.privacy}>Privacy Policy</Link>, the{' '}
          <Link to={LEGAL_ROUTES.cashback}>Cash Back Terms &amp; Conditions</Link>, and any
          Guidelines are the entire agreement between you and RBIT on this subject and supersede
          prior understandings.
        </P>
        <P>
          <strong>Severability.</strong> If any provision is held unenforceable, the rest of these
          Terms remain in effect, interpreted to reflect the parties&apos; original intent.
        </P>
        <P>
          <strong>Assignment.</strong> You may not assign these Terms without RBIT&apos;s written
          consent; RBIT may assign them freely.
        </P>
        <P>
          <strong>Governing law; venue.</strong> Except as set out in Section 8 (Arbitration), these
          Terms are governed by the laws of the State of Texas, without regard to conflict-of-laws
          rules, and any permitted court action will be brought in Travis County, Texas.
        </P>

        <H>12. Contact &amp; Notices</H>
        <P>Questions about these Terms or the Service can be directed to:</P>
        <P>
          RBIT Financial Inc., Attn: Legal, 2810 N. Church St., #223722, Wilmington, DE 19802.
          Email: <a href="mailto:info@rbitfinancial.com">info@rbitfinancial.com</a>
        </P>
        <P>Copyright/DMCA notices should go to the same address, attention Copyright Agent.</P>
      </LegalDocLayout>
    </Shell>
  );
}

/** Cash Back Terms — referenced by Terms §1. Draft until LEGAL_APPROVED.cashback flips. */
export function CashbackTermsPage() {
  return (
    <Shell>
      <LegalDocLayout title="Cash Back Terms & Conditions" gate="cashback">
        <P>
          <em>RBIT Financial Inc. — Dwel &amp; Lumis</em>
        </P>
        <P>
          1. Cashback and incentive amounts under Dwel, and reimbursement amounts under Lumis, are
          calculated and disclosed to you at the time of your application or listing view. Disclosed
          amounts are estimates until confirmed at the qualifying event (lease signing for Dwel; PTO
          and monthly bill upload for Lumis).
        </P>
        <P>
          2. Payment timing. Dwel cashback is issued within 30 days after RBIT confirms your lease
          has been signed with a participating Landlord. Lumis reimbursements are issued monthly,
          within 30 days of a valid utility bill upload, up to the $2,000 program cap or 7 months,
          whichever comes first.
        </P>
        <P>
          3. Payment method. Payments are issued via the payment method on file (ACH or equivalent)
          through RBIT&apos;s payment processor (Stripe).
        </P>
        <P>
          4. Clawback. RBIT may reclaim (claw back) a cashback or reimbursement payment already
          issued if: (a) the underlying lease is terminated, rescinded, or later found to have been
          procured through fraud within 90 days of signing (Dwel); (b) a submitted utility bill is
          later found to be falsified or altered (Lumis); (c) the recipient provided false
          information material to their eligibility for the program; or (d) the payment was issued
          in error. RBIT will provide written notice before initiating a clawback and a reasonable
          opportunity to respond.
        </P>
        <P>
          5. Program changes. RBIT may modify cashback amounts, reimbursement caps, or eligibility
          criteria for future applicants/participants at any time; changes do not apply
          retroactively to amounts already earned and confirmed.
        </P>
        <P>
          6. Not an investment. Cashback and reimbursement payments are not a security, deposit,
          investment, or savings product, and carry no interest or rate of return.
        </P>
        <P>
          7. Tax responsibility. Recipients are solely responsible for any tax reporting or
          liability arising from cashback or reimbursement payments received. RBIT may issue
          applicable tax forms (e.g., Form 1099) where required by law.
        </P>
      </LegalDocLayout>
    </Shell>
  );
}

/** Privacy Policy — project copy. Draft until LEGAL_APPROVED.privacy flips. */
export function PrivacyPage() {
  return (
    <Shell>
      <LegalDocLayout title="Privacy Policy" gate="privacy">
        <P>
          <em>RBIT Financial Inc.</em>
        </P>
        <H>1. Information We Collect</H>
        <Ul>
          <li>Account information (name, email, phone) you provide directly.</li>
          <li>
            Applicant verification documents you upload, which may include a government-issued photo
            ID, proof of income (such as recent pay stubs, an offer letter, or tax return), and
            rental history or landlord references.
          </li>
          <li>
            Landlord/owner verification documents: utility bill, deed/ownership title,
            government-issued ID, rental registration number (if applicable).
          </li>
          <li>
            Broker/agent license number, issuing state, and supervising broker-of-record license
            number.
          </li>
          <li>
            Screening report data obtained from our Screening Partner (Certn) when you initiate a
            background/credit check, including identity verification and consumer report contents as
            permitted by the FCRA.
          </li>
          <li>
            Payment information, processed by our payment processor (Stripe); RBIT does not store
            full card or bank account numbers.
          </li>
          <li>Usage data (pages visited, actions taken on the Platform).</li>
        </Ul>
        <H>2. How We Use Information</H>
        <Ul>
          <li>
            To operate the marketplace: matching Applicants and Landlords, verifying Broker licenses,
            processing screening requests, and paying out cashback/placement fees.
          </li>
          <li>
            To comply with legal obligations, including FCRA-mandated adverse action notices and
            state real-estate licensing verification.
          </li>
          <li>To communicate with you about your account, applications, and transactions.</li>
        </Ul>
        <H>3. How We Share Information</H>
        <Ul>
          <li>
            With our Screening Partner (Certn) to perform background/credit checks you authorize.
          </li>
          <li>
            With Landlords/Brokers you apply to, and with Applicants who apply to a Landlord&apos;s
            listing, as necessary to facilitate the rental transaction.
          </li>
          <li>With state licensing boards for Broker/agent license verification.</li>
          <li>
            With service providers (payment processing via Stripe, cloud infrastructure via AWS)
            under contracts limiting their use of your data to providing services to RBIT.
          </li>
        </Ul>
        <P>
          RBIT does not sell your personal information, and does not share it for cross-context
          behavioral advertising, as those terms are defined under the CCPA/CPRA.
        </P>
        <H>4. Your Rights</H>
        <Ul>
          <li>
            Under the FCRA, if adverse action is taken against you based in whole or in part on a
            consumer report, you have the right to receive notice, a copy of the report, and to
            dispute inaccurate information with the Screening Partner.
          </li>
          <li>
            California residents: see our <Link to={LEGAL_ROUTES.ccpa}>CCPA Notice</Link> for
            additional rights, including the right to know, delete, and opt out.
          </li>
          <li>
            Residents of Virginia, Colorado, Connecticut, Utah, and other states with comprehensive
            consumer privacy laws have similar rights to know, access, correct, delete, and opt out
            of certain processing of their personal information, subject to each state&apos;s
            specific requirements. To exercise these rights, contact{' '}
            <a href="mailto:info@rbitfinancial.com">info@rbitfinancial.com</a>.
          </li>
        </Ul>
        <H>5. Data Retention</H>
        <P>
          RBIT retains screening reports and verification documents for the duration of your active
          account and for 24 months thereafter, or longer where required by applicable law
          (including FCRA recordkeeping obligations), after which they are securely deleted. Account
          information is retained until you request deletion, subject to RBIT&apos;s own legal and
          recordkeeping obligations.
        </P>
        <H>6. Security</H>
        <P>
          RBIT stores data on AWS infrastructure with encryption at rest (KMS) and in transit. No
          system is fully secure; we cannot guarantee absolute security.
        </P>
        <H>7. Children&apos;s Privacy</H>
        <P>
          The Platform is not directed to individuals under 18, and RBIT does not knowingly collect
          data from minors.
        </P>
        <H>8. Changes to This Policy</H>
        <P>
          We may update this Privacy Policy; material changes will be communicated as required by
          law.
        </P>
        <H>9. Contact</H>
        <P>
          Questions about this Privacy Policy can be directed to{' '}
          <a href="mailto:info@rbitfinancial.com">info@rbitfinancial.com</a>. RBIT does not
          currently have a designated Data Protection Officer.
        </P>
      </LegalDocLayout>
    </Shell>
  );
}

/** CCPA notice — project copy. Draft until LEGAL_APPROVED.ccpa flips. */
export function CcpaPage() {
  return (
    <Shell>
      <LegalDocLayout title="Do not sell or share my personal info" gate="ccpa">
        <P>
          RBIT does not sell your personal information, and does not share it for purposes of
          cross-context behavioral advertising, as those terms are defined under the California
          Consumer Privacy Act (CCPA) as amended by the California Privacy Rights Act (CPRA). RBIT
          shares personal information only with service providers and business partners as necessary
          to operate the Service, as described in our{' '}
          <Link to={LEGAL_ROUTES.privacy}>Privacy Policy</Link>.
        </P>
        <P>
          If RBIT&apos;s data practices change in a way that would constitute a &quot;sale&quot; or
          &quot;share&quot; under the CCPA/CPRA, this page will be updated to include a functional
          opt-out mechanism at that time.
        </P>
        <P>
          California residents may still exercise their other rights under the CCPA — including the
          right to know, delete, and correct personal information — by contacting{' '}
          <a href="mailto:info@rbitfinancial.com">info@rbitfinancial.com</a>.
        </P>
      </LegalDocLayout>
    </Shell>
  );
}
