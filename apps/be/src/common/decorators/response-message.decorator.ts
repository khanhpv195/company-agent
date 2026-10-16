import { SetMetadata } from '@nestjs/common';
import { RAW_RESPONSE_KEY, RESPONSE_MESSAGE_KEY } from '../../contacts';

/** i18n key used as `message` in the wrapped success response. */
export const ResponseMessage = (i18nKey: string) => SetMetadata(RESPONSE_MESSAGE_KEY, i18nKey);

/** Skip the `{ success, data, message }` envelope for this handler/controller. */
export const RawResponse = () => SetMetadata(RAW_RESPONSE_KEY, true);
