import Head from 'next/head';
import { useEffect, useState } from 'react';

export default function Home() {
  const [apiStatus, setApiStatus] = useState('loading');

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/health`);
        if (response.ok) {
          setApiStatus('connected');
        }
      } catch (error) {
        setApiStatus('disconnected');
      }
    };
    checkHealth();
  }, []);

  return (
    <>
      <Head>
        <title>HirePilot</title>
        <meta name="description" content="HirePilot - Rebuild" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <main>
        <h1>HirePilot</h1>
        <p>Welcome to HirePilot Rebuild</p>
        <p>API Status: <strong>{apiStatus}</strong></p>
      </main>
    </>
  );
}
