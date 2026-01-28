/**
 * Cloudflare Worker para troca de tokens Strava
 *
 * INSTRUÇÕES DE DEPLOY:
 * 1. Acesse https://dash.cloudflare.com/
 * 2. Crie uma conta gratuita (se não tiver)
 * 3. Vá em Workers & Pages > Create Application > Create Worker
 * 4. Cole este código
 * 5. Adicione as variáveis de ambiente:
 *    - STRAVA_CLIENT_ID: 146527
 *    - STRAVA_CLIENT_SECRET: (seu secret)
 * 6. Faça deploy e copie a URL do worker
 * 7. Atualize a URL no index.html (STRAVA_TOKEN_PROXY)
 */

export default {
    async fetch(request, env) {
        // CORS headers
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        // Handle preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        if (request.method !== 'POST') {
            return new Response('Method not allowed', { status: 405, headers: corsHeaders });
        }

        try {
            const body = await request.json();
            const { code, grant_type, refresh_token } = body;

            let tokenRequest = {
                client_id: env.STRAVA_CLIENT_ID,
                client_secret: env.STRAVA_CLIENT_SECRET,
            };

            if (grant_type === 'refresh_token') {
                tokenRequest.grant_type = 'refresh_token';
                tokenRequest.refresh_token = refresh_token;
            } else {
                tokenRequest.grant_type = 'authorization_code';
                tokenRequest.code = code;
            }

            const response = await fetch('https://www.strava.com/oauth/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams(tokenRequest).toString(),
            });

            const data = await response.json();

            return new Response(JSON.stringify(data), {
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders,
                },
            });

        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders,
                },
            });
        }
    },
};
