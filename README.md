# DEPENDE ROUTE CLUB

Catálogo colaborativo de rotas de corrida e trail running com mapas interativos, análise de elevação e download de arquivos GPX.

## Funcionalidades

- **Catálogo de Rotas** - Navegue por rotas de corrida e trail running com filtros por dificuldade, terreno e cidade
- **Mapas Interativos** - Visualize o trajeto completo com perfil de elevação usando Leaflet
- **Download GPX** - Baixe os arquivos GPX para usar no seu GPS ou app de corrida
- **Perto de Mim** - Encontre rotas em um raio de 20km da sua localização
- **Integração Strava** - Sincronize suas atividades e veja quais rotas você já completou
- **Sistema de Favoritos** - Salve suas rotas preferidas para acesso rápido
- **PWA** - Instale como app no celular e use offline
- **Filtros Salvos** - Salve combinações de filtros para uso rápido

## Tecnologias

- HTML5 / CSS3 / JavaScript (Vanilla)
- Firebase (Firestore, Hosting, Auth)
- Leaflet.js (Mapas)
- Chart.js (Gráficos de elevação)
- Service Workers (PWA / Offline)

## Estrutura do Projeto

```
├── index.html              # Aplicação principal (SPA)
├── callback.html           # Callback OAuth Strava
├── offline.html            # Página offline
├── privacy.html            # Política de privacidade
├── manifest.json           # Configuração PWA
├── sw.js                   # Service Worker
├── firebase-messaging-sw.js # Firebase Messaging Worker
├── firebase.json           # Configuração Firebase Hosting
├── firestore.rules         # Regras do Firestore
├── logo.png                # Logo do app
├── icons/                  # Ícones PWA
└── routes/                 # Arquivos GPX das rotas
```

## Instalação Local

1. Clone o repositório:
```bash
git clone https://github.com/seu-usuario/depende-route-club.git
cd depende-route-club
```

2. Inicie um servidor local:
```bash
npx serve .
# ou
python -m http.server 8000
```

3. Acesse `http://localhost:8000`

## Deploy

O projeto está configurado para deploy no Firebase Hosting:

```bash
npx firebase deploy --only hosting
```

## Contribuindo com Rotas

1. Faça login no app
2. Vá em "Upload GPX"
3. Envie seu arquivo GPX
4. Preencha as informações da rota
5. Aguarde aprovação de um administrador

## Níveis de Dificuldade

| Nível | Descrição |
|-------|-----------|
| Fácil | Terreno plano, até 100m D+ |
| Moderada | Alguns aclives, 100-300m D+ |
| Difícil | Aclives consideráveis, 300-600m D+ |
| Muito Difícil | Terreno técnico, 600-1000m D+ |
| Extrema | Alta altitude, +1000m D+ |

## Licença

Este projeto é de uso privado do DEPENDE ROUTE CLUB.

## Contato

Para dúvidas ou sugestões, entre em contato através do app.
