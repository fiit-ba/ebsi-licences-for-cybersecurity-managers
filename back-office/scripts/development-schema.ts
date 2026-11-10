import type { SchemaField } from '../server/schemas/types.ts';

/** 15-field development certificate contract, labels, hints and defaults. */
export const developmentSchema = {
  credential_type: 'CybersecurityManagerCertificate',
  name_sk: 'Manažér kybernetickej bezpečnosti',
  name_en: 'Cybersecurity manager',
  fields: [
    {
      key: 'certificateTitle',
      kind: 'text',
      section: 'certificate',
      required: true,
      default: 'Osvedčenie o absolvovaní školiacej aktivity a úspešnom vykonaní záverečného testu',
      organization: false,
      label: {
        sk: 'Názov osvedčenia',
        en: 'Certificate title',
      },
      hint: {
        sk: '',
        en: '',
      },
    },
    {
      key: 'holderName',
      kind: 'text',
      section: 'holder',
      required: true,
      default: '',
      organization: false,
      label: {
        sk: 'Meno a priezvisko s titulmi',
        en: 'Name with titles',
      },
      hint: {
        sk: 'napr. Ing. Janko Mrkvička, PhD.',
        en: 'e.g. Ing. Janko Mrkvička, PhD.',
      },
    },
    {
      key: 'jobPosition',
      kind: 'text',
      section: 'holder',
      required: false,
      default: 'manažér kybernetickej bezpečnosti',
      organization: false,
      label: {
        sk: 'Pracovné zaradenie',
        en: 'Job position',
      },
      hint: {
        sk: '',
        en: '',
      },
    },
    {
      key: 'trainingName',
      kind: 'text',
      section: 'training',
      required: true,
      default: 'Manažér kybernetickej bezpečnosti',
      organization: false,
      label: {
        sk: 'Názov školenia',
        en: 'Training',
      },
      hint: {
        sk: '',
        en: '',
      },
    },
    {
      key: 'trainingStart',
      kind: 'date',
      section: 'training',
      required: true,
      default: '',
      organization: false,
      label: {
        sk: 'Školenie od',
        en: 'Training from',
      },
      hint: {
        sk: '',
        en: '',
      },
    },
    {
      key: 'trainingEnd',
      kind: 'date',
      section: 'training',
      required: true,
      default: '',
      organization: false,
      label: {
        sk: 'Školenie do',
        en: 'Training until',
      },
      hint: {
        sk: '',
        en: '',
      },
    },
    {
      key: 'trainingDays',
      kind: 'integer',
      section: 'training',
      required: true,
      default: '',
      organization: false,
      label: {
        sk: 'Počet školiacich dní',
        en: 'Training days',
      },
      hint: {
        sk: '',
        en: '',
      },
    },
    {
      key: 'teachingHours',
      kind: 'integer',
      section: 'training',
      required: true,
      default: '',
      organization: false,
      label: {
        sk: 'Počet vyučovacích hodín',
        en: 'Teaching hours',
      },
      hint: {
        sk: '',
        en: '',
      },
    },
    {
      key: 'knowledgeStandard',
      kind: 'text',
      section: 'training',
      required: true,
      default: 'vyhláška Národného bezpečnostného úradu č. 492/2022 Z. z.',
      organization: false,
      label: {
        sk: 'Znalostný štandard',
        en: 'Knowledge standard',
      },
      hint: {
        sk: '',
        en: '',
      },
    },
    {
      key: 'certificateNumber',
      kind: 'text',
      section: 'certificate',
      required: true,
      default: '',
      organization: false,
      label: {
        sk: 'Číslo osvedčenia',
        en: 'Certificate number',
      },
      hint: {
        sk: 'napr. 248',
        en: 'e.g. 248',
      },
    },
    {
      key: 'placeOfIssue',
      kind: 'text',
      section: 'certificate',
      required: true,
      default: '',
      organization: false,
      label: {
        sk: 'Miesto vydania',
        en: 'Place of issue',
      },
      hint: {
        sk: 'napr. Bratislava',
        en: 'e.g. Bratislava',
      },
    },
    {
      key: 'issueDate',
      kind: 'date',
      section: 'certificate',
      required: true,
      default: '',
      organization: false,
      label: {
        sk: 'Dátum vydania',
        en: 'Date of issue',
      },
      hint: {
        sk: '',
        en: '',
      },
    },
    {
      key: 'certificationBody',
      kind: 'text',
      section: 'certificate',
      required: true,
      default: '',
      organization: true,
      label: {
        sk: 'Vydavateľ osvedčenia',
        en: 'Issued by',
      },
      hint: {
        sk: '',
        en: '',
      },
    },
    {
      key: 'signatory',
      kind: 'text',
      section: 'certificate',
      required: true,
      default: '',
      organization: false,
      label: {
        sk: 'Podpísal (meno a funkcia)',
        en: 'Signed by (name and function)',
      },
      hint: {
        sk: 'napr. prof. Ing. Ján Novák, PhD., dekan',
        en: 'e.g. prof. Ing. Ján Novák, PhD., dean',
      },
    },
    {
      key: 'funding',
      kind: 'text',
      section: 'certificate',
      required: false,
      default: '',
      organization: false,
      label: {
        sk: 'Financovanie',
        en: 'Funding',
      },
      hint: {
        sk: 'napr. Plán obnovy a odolnosti SR, Komponent 17, Reforma č. 5',
        en: 'e.g. Recovery and Resilience Plan, Component 17, Reform 5',
      },
    },
  ] satisfies SchemaField[],
};
