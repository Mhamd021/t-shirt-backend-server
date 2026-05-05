# T-Shirt Model Backend

Professional backend API for the T-Shirt Model project. This server powers user authentication, saved shirt designs, image uploads, AI-assisted design generation, order management, printer/admin workflows, and email notifications.

The application is built with **NestJS**, **TypeScript**, **Prisma**, and **PostgreSQL**. It is designed as a modular API that supports the frontend T-shirt customizer and the operational flow from customer design creation to printable order fulfillment.

## Table of Contents

- [Tech Stack](#tech-stack)
- [Backend Responsibilities](#backend-responsibilities)
- [Project Structure](#project-structure)
- [Core Modules](#core-modules)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Database and Prisma](#database-and-prisma)
- [API Overview](#api-overview)
- [AI Provider Behavior](#ai-provider-behavior)
- [Available Scripts](#available-scripts)
- [Docker Usage](#docker-usage)
- [Testing](#testing)
- [Production Notes](#production-notes)

## Tech Stack

- **Runtime:** Node.js 20+
- **Framework:** NestJS 11
- **Language:** TypeScript
- **Database:** PostgreSQL
- **ORM:** Prisma
- **Authentication:** Passport JWT
- **Password Hashing:** bcrypt
- **Validation:** class-validator and NestJS `ValidationPipe`
- **File Uploads:** Multer
- **Image Storage:** Cloudinary
- **Background Removal:** remove.bg API
- **Email Delivery:** Resend
- **AI Providers:** Ollama for development, OpenAI for production
- **Testing:** Jest and Supertest

## Backend Responsibilities

This server handles the backend domain for a custom T-shirt design platform:

- Registering and authenticating users.
- Issuing JWT tokens for protected API access.
- Managing customer-created shirt designs.
- Persisting decals, text layers, image layers, placement, scale, and orientation.
- Uploading decal images to Cloudinary.
- Removing image backgrounds before upload when requested.
- Generating AI design suggestions, color palettes, and decal text ideas.
- Creating customer orders from saved designs.
- Tracking order status through the production pipeline.
- Supporting printer and admin role-based workflows.
- Sending order notifications to the configured printer email address.

## Project Structure

```text
server/
|-- prisma/
|   |-- schema.prisma          # Prisma database schema
|   `-- migrations/            # Database migration history
|-- src/
|   |-- admin/                 # Admin-only user role management
|   |-- ai/                    # AI endpoints and provider abstraction
|   |   `-- providers/         # Ollama and OpenAI provider implementations
|   |-- auth/                  # Registration, login, JWT strategy
|   |-- common/                # Shared decorators and guards
|   |-- design/                # Design CRUD and decal persistence
|   |-- mail/                  # Resend email notifications
|   |-- order/                 # Order creation and status management
|   |-- prisma/                # Prisma service and module
|   |-- upload/                # Cloudinary uploads and background removal
|   |-- users/                 # User lookup and role updates
|   |-- app.module.ts          # Root application module
|   `-- main.ts                # Application bootstrap
|-- test/                      # End-to-end test configuration
|-- Dockerfile                 # Server container build
|-- package.json               # Scripts and dependencies
`-- README.md
```

## Core Modules

### Auth Module

Provides registration, login, JWT generation, and current-user lookup.

Main routes:

- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`

### Users Module

Encapsulates user access and update logic. It is used by authentication and admin workflows.

### Design Module

Manages saved shirt designs for authenticated users. A design can include:

- Shirt color.
- Design name.
- Visibility flag.
- Text decals.
- Image decals.
- Decal side, position, orientation, and scale.

Main routes:

- `POST /designs`
- `GET /designs`
- `GET /designs/:id`
- `PUT /designs/:id`
- `DELETE /designs/:id`

### Upload Module

Handles protected image upload flows:

- Upload original images to Cloudinary.
- Remove an image background through remove.bg.
- Upload the cleaned image to Cloudinary.

Main routes:

- `POST /upload/image`
- `POST /upload/image/remove-bg`

Both routes expect a multipart form-data file field named `file`.

### AI Module

Provides AI-assisted design tools for authenticated users:

- T-shirt design suggestions.
- Color palette generation.
- Short decal text ideas.

Main routes:

- `POST /ai/design-suggestions`
- `POST /ai/color-palette`
- `POST /ai/decal-text`

### Order Module

Handles customer orders and printer/admin order operations.

Customer capabilities:

- Create an order from a saved design.
- View their own orders.
- View a specific order that belongs to them.

Printer/admin capabilities:

- View all orders.
- Update order status.

Main routes:

- `POST /orders`
- `GET /orders/my`
- `GET /orders/:id`
- `GET /orders`
- `PATCH /orders/:id/status`

### Admin Module

Provides admin-only user role management.

Main route:

- `PATCH /admin/users/:id/role`

Supported roles are defined in Prisma:

- `CUSTOMER`
- `PRINTER`
- `ADMIN`

### Mail Module

Sends new-order notifications to the configured printer email address using Resend.

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create a `.env` file inside the `server/` directory and provide the values described in [Environment Variables](#environment-variables).

### 3. Generate the Prisma client

```bash
npm run prisma:generate
```

### 4. Apply database migrations

```bash
npm run prisma:migrate:dev
```

For quick local schema synchronization without creating a migration:

```bash
npm run prisma:push
```

### 5. Start the development server

```bash
npm run start:dev
```

By default, the API listens on:

```text
http://localhost:3001
```

## Environment Variables

The server reads configuration from environment variables through `@nestjs/config`, `dotenv`, Prisma, and provider-specific services.

```env
PORT=3001
NODE_ENV=development

DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE"
JWT_SECRET="replace-with-a-secure-secret"

CLOUDINARY_CLOUD_NAME="your-cloudinary-cloud-name"
CLOUDINARY_API_KEY="your-cloudinary-api-key"
CLOUDINARY_API_SECRET="your-cloudinary-api-secret"

REMOVEBG_API_KEY="your-removebg-api-key"

RESEND_API_KEY="your-resend-api-key"
PRINTER_EMAIL="printer@example.com"

OPENAI_API_KEY="your-openai-api-key"
```

Notes:

- `OPENAI_API_KEY` is required for production AI generation.
- In development, the AI service uses Ollama by default.
- `DATABASE_URL` is required by the Prisma service.
- `JWT_SECRET` should be a strong secret in every non-local environment.

## Database and Prisma

The Prisma schema defines the main backend domain:

- `User`
- `Design`
- `Decal`
- `Order`

Important enums:

- `Role`: `CUSTOMER`, `PRINTER`, `ADMIN`
- `DecalType`: `TEXT`, `IMAGE`
- `ShirtSize`: `XS`, `S`, `M`, `L`, `XL`, `XXL`
- `OrderStatus`: `PENDING`, `CONFIRMED`, `PRINTING`, `SHIPPED`, `DELIVERED`, `CANCELLED`

Useful Prisma commands:

```bash
npm run prisma:generate
npm run prisma:migrate:dev
npm run prisma:push
npm run prisma:studio
```

## API Overview

Most application routes are protected with JWT authentication. Send the access token returned by login in the `Authorization` header:

```text
Authorization: Bearer <access_token>
```

### Authentication

```http
POST /auth/register
POST /auth/login
GET  /auth/me
```

### Designs

```http
POST   /designs
GET    /designs
GET    /designs/:id
PUT    /designs/:id
DELETE /designs/:id
```

### Uploads

```http
POST /upload/image
POST /upload/image/remove-bg
```

### AI

```http
POST /ai/design-suggestions
POST /ai/color-palette
POST /ai/decal-text
```

### Orders

```http
POST  /orders
GET   /orders/my
GET   /orders/:id
GET   /orders
PATCH /orders/:id/status
```

### Admin

```http
PATCH /admin/users/:id/role
```

## AI Provider Behavior

The AI module uses a provider interface so the application can swap AI backends without changing controller logic.

- In non-production environments, the service uses **Ollama** at `http://localhost:11434` with the `tinyllama` model.
- In production, the service uses **OpenAI** through the configured `OPENAI_API_KEY`.

The provider abstraction supports:

- `generateDesignSuggestions(prompt)`
- `generateColorPalette(theme)`
- `generateDecalText(context)`

## Available Scripts

```bash
npm run build              # Compile the NestJS app
npm run start              # Start the app
npm run start:dev          # Start in watch mode
npm run start:debug        # Start in debug watch mode
npm run start:prod         # Run compiled output from dist/
npm run format             # Format source and test files
npm run lint               # Run ESLint with auto-fix
npm run test               # Run unit tests
npm run test:watch         # Run unit tests in watch mode
npm run test:cov           # Run unit tests with coverage
npm run test:e2e           # Run end-to-end tests
npm run prisma:generate    # Generate Prisma client
npm run prisma:migrate:dev # Create/apply development migrations
npm run prisma:push        # Push schema changes to the database
npm run prisma:studio      # Open Prisma Studio
```

## Docker Usage

The server includes a `Dockerfile` and is also wired into the root `docker-compose.yml`.

From the repository root:

```bash
docker compose up --build
```

The compose stack includes:

- Frontend application.
- NestJS server.
- PostgreSQL database.
- Nginx reverse proxy.

## Testing

Run unit tests:

```bash
npm run test
```

Run end-to-end tests:

```bash
npm run test:e2e
```

Generate coverage:

```bash
npm run test:cov
```

## Production Notes

- Set `NODE_ENV=production` to use the OpenAI provider.
- Provide secure production values for `JWT_SECRET`, `DATABASE_URL`, and all third-party API keys.
- Run `npm run build` before `npm run start:prod`.
- Apply Prisma migrations before serving production traffic.
- Use a managed PostgreSQL database or a properly backed-up database volume.
- Keep Cloudinary, remove.bg, Resend, and OpenAI keys outside source control.
