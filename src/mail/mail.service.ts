import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Resend } from 'resend';

type OrderForMail = Prisma.OrderGetPayload<{
  include: {
    design: { include: { decals: true } };
    user: { select: { name: true; email: true } };
  };
}>;

type Address = {
  street?: string;
  city?: string;
  country?: string;
  zip?: string;
};

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

@Injectable()
export class MailService {
  private resend: Resend;

  constructor(private config: ConfigService) {
    this.resend = new Resend(config.getOrThrow('RESEND_API_KEY'));
  }

  async sendNewOrderNotification(order: OrderForMail): Promise<void> {
    const address = (order.address ?? {}) as Address;

    const { error } = await this.resend.emails.send({
      from: 'T-Shirt Studio <onboarding@resend.dev>',
      to: this.config.getOrThrow('PRINTER_EMAIL'),
      subject: `New Order #${order.id} — ${esc(order.size)} shirt`,
      html: `
        <div style="font-family: Arial; max-width: 600px;">
          <h2>New Order Received</h2>
          <table style="width:100%; border-collapse: collapse;">
            <tr>
              <td style="padding:8px; font-weight:bold;">Order ID</td>
              <td style="padding:8px;">#${order.id}</td>
            </tr>
            <tr style="background:#f5f5f5;">
              <td style="padding:8px; font-weight:bold;">Customer</td>
              <td style="padding:8px;">
                ${esc(order.user?.name)} (${esc(order.user?.email)})
              </td>
            </tr>
            <tr>
              <td style="padding:8px; font-weight:bold;">Size</td>
              <td style="padding:8px;">${esc(order.size)}</td>
            </tr>
            <tr style="background:#f5f5f5;">
              <td style="padding:8px; font-weight:bold;">Shirt Color</td>
              <td style="padding:8px;">${esc(order.design?.shirtColor)}</td>
            </tr>
            <tr>
              <td style="padding:8px; font-weight:bold;">Decals</td>
              <td style="padding:8px;">
                ${order.design?.decals?.length ?? 0} layer(s)
              </td>
            </tr>
            <tr style="background:#f5f5f5;">
              <td style="padding:8px; font-weight:bold;">Address</td>
              <td style="padding:8px;">
                ${esc(address.street)},
                ${esc(address.city)},
                ${esc(address.country)}
                ${esc(address.zip)}
              </td>
            </tr>
            <tr>
              <td style="padding:8px; font-weight:bold;">Notes</td>
              <td style="padding:8px;">${esc(order.notes ?? 'None')}</td>
            </tr>
          </table>
        </div>
      `,
    });

    
    if (error) {
      throw new Error(`Resend failed: ${error.message}`);
    }
  }
}

