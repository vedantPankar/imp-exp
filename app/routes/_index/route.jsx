import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>MobiMigrate</h1>
        <p className={styles.text}>
          Move pages, blog posts, menus, files and product media between Shopify stores using a ZIP file.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Export</strong>. Download your store&apos;s pages, blog
            posts, menus, files and product media as a ZIP file.
          </li>
          <li>
            <strong>Import</strong>. Upload that ZIP into another store and
            choose which content types to bring in.
          </li>
          <li>
            <strong>Large stores</strong>. Big exports are split into several
            ZIP parts automatically.
          </li>
        </ul>
      </div>
    </div>
  );
}
