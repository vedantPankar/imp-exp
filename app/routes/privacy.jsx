// Public privacy policy page (no authentication), linked from the App Store listing.

export const meta = () => [{ title: "MobiMigrate Privacy Policy" }];

const CONTACT_EMAIL = "info@mobidrag.com";

export default function Privacy() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "32px 16px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        lineHeight: 1.6,
        color: "#202223",
      }}
    >
      <h1>MobiMigrate Privacy Policy</h1>
      <p>Effective date: 8 October 2026</p>
      <p>
        MobiMigrate (&quot;the app&quot;) is operated by Mobidrag Technologies
        (&quot;we&quot;, &quot;us&quot;). The app lets a Shopify merchant export
        store content to a ZIP file and import it into another store. This page
        explains what data the app handles.
      </p>

      <h2>Data we store</h2>
      <ul>
        <li>
          <strong>Shop and session data.</strong> When you install the app, we
          store your shop domain and the access token Shopify issues so the app
          can call Shopify on your behalf. If you sign in as a staff member, the
          session may also include your name, email address and locale as
          provided by Shopify.
        </li>
        <li>
          <strong>App settings.</strong> Your export and import choices (for
          example, which content types to include).
        </li>
        <li>
          <strong>Run history.</strong> For each shop, the number of items, the
          total size and the time of the last export or import.
        </li>
      </ul>

      <h2>Data we do not store</h2>
      <ul>
        <li>
          We do not collect or store your customers&apos; personal data, and the
          app does not read customers or orders.
        </li>
        <li>
          We do not store your exported content. Exports are assembled in your
          browser and saved to your device as a ZIP file. If your browser cannot
          download a file directly, the file is streamed through our server to
          your browser and is not saved or logged.
        </li>
      </ul>

      <h2>How we use data</h2>
      <p>
        We use the data above only to run the app: to authenticate with Shopify,
        remember your settings and show your recent activity. We do not sell
        your data, share it with third parties for marketing, or use it for
        advertising.
      </p>

      <h2>Shopify access</h2>
      <p>
        The app requests access to files, products, content, online store pages
        and online store navigation, only to read and write the content you
        choose to export or import.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        When you uninstall the app, Shopify notifies us, and we delete all data
        stored for your shop (session, settings and run history) after the
        deletion request Shopify sends. We also honour Shopify&apos;s mandatory
        privacy requests (customer data request, customer redact and shop
        redact).
      </p>

      <h2>Security</h2>
      <p>
        All traffic uses HTTPS. Requests to Shopify and from Shopify webhooks
        are authenticated and verified.
      </p>

      <h2>Your rights</h2>
      <p>
        You may ask us what data we hold about your shop, or ask us to delete
        it, by emailing us. If you are in the European Economic Area, the United
        Kingdom or a similar jurisdiction, you may also have rights to access,
        correct and delete your personal data.
      </p>

      <h2>Changes</h2>
      <p>
        We may update this policy. The effective date above shows when it last
        changed.
      </p>

      <h2>Contact</h2>
      <p>
        Questions or requests: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>
    </main>
  );
}
