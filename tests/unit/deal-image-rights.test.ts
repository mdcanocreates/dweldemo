import { describe, expect, it } from 'vitest';
import { planDealImageIngest } from '../../src/modules/external-listings/image-plan.js';
import {
  RENT_COM_DEAL_PACKAGE_PERMISSION,
  decideImageUse,
  type SourceMediaPermission,
} from '../../src/modules/external-listings/image-rights.js';

const approvedHost: SourceMediaPermission = {
  providerKey: 'rent_com_deal_package',
  status: 'approved',
  licenseEvidenceRef: 'agreement-2026-display-rehost',
  permittedFields: ['address', 'photos'],
  mediaPolicy: 'host',
};

describe('deal image source permissions', () => {
  it('keeps the recorded Rent.com package grant from publishing photos', () => {
    expect(decideImageUse(RENT_COM_DEAL_PACKAGE_PERMISSION)).toEqual({
      action: 'reject',
      reason: 'source_status_unverified',
    });
  });

  it('does not treat a prompt sentence as a grant when the recorded fields omit photos', () => {
    expect(
      decideImageUse({
        ...RENT_COM_DEAL_PACKAGE_PERMISSION,
        status: 'approved',
        licenseEvidenceRef: 'package-prompt-claims-display',
      }),
    ).toEqual({ action: 'reject', reason: 'photos_not_in_permitted_fields' });
  });

  it('hosts every approved image, including a URL shared by two properties', () => {
    const plan = planDealImageIngest({
      permission: approvedHost,
      links: [
        { externalId: 'rent_a', listingId: '11111111-1111-1111-1111-111111111111' },
        { externalId: 'rent_b', listingId: '22222222-2222-2222-2222-222222222222' },
      ],
      urlAlive: new Map([
        ['https://cdn.example/one.jpg', true],
        ['https://cdn.example/shared.jpg', true],
      ]),
      groups: [
        {
          externalId: 'rent_a',
          propertyName: 'One',
          sourceUrl: null,
          photos: ['https://cdn.example/one.jpg', 'https://cdn.example/shared.jpg'],
        },
        {
          externalId: 'rent_b',
          propertyName: 'Two',
          sourceUrl: null,
          photos: ['https://cdn.example/shared.jpg'],
        },
      ],
    });

    expect(plan.summary.approvedToHost).toBe(3);
    expect(plan.summary.rejected).toBe(0);
    expect(plan.summary.sharedAcrossProperties).toBe(1);
    expect(plan.images.map((image) => image.listingId)).toEqual([
      '11111111-1111-1111-1111-111111111111',
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    ]);
  });

  it('rejects the recorded grant without dropping the image from the report', () => {
    const plan = planDealImageIngest({
      permission: RENT_COM_DEAL_PACKAGE_PERMISSION,
      groups: [
        {
          externalId: 'rent_lc6817577',
          propertyName: 'The Terrace',
          sourceUrl: 'https://www.rent.com/apartment/the-terrace-austin-tx-lc6817577',
          photos: ['https://i.rent.com/t_3x2_fixed_webp_xl/abc'],
        },
      ],
    });
    expect(plan.summary.imageReferences).toBe(1);
    expect(plan.summary.approvedToHost).toBe(0);
    expect(plan.summary.rejectedByReason).toEqual({ source_status_unverified: 1 });
    expect(plan.images[0]?.originUrl).toContain('i.rent.com');
  });

  it('rejects an approved URL that no longer resolves, and still hosts the live sibling', () => {
    const plan = planDealImageIngest({
      permission: approvedHost,
      links: [{ externalId: 'rent_a', listingId: '11111111-1111-1111-1111-111111111111' }],
      urlAlive: new Map([
        ['https://cdn.example/live.jpg', true],
        ['https://cdn.example/dead.jpg', false],
      ]),
      groups: [
        {
          externalId: 'rent_a',
          propertyName: 'One',
          sourceUrl: null,
          photos: ['https://cdn.example/live.jpg', 'https://cdn.example/dead.jpg'],
        },
      ],
    });
    expect(plan.summary.approvedToHost).toBe(1);
    expect(plan.summary.rejectedByReason).toEqual({ source_url_unreachable: 1 });
  });
});
