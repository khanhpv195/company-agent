import { applyDecorators, HttpStatus, Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { PaginationMetaDto, ResponseDto } from '../dto/response.dto';

export const ApiWrappedResponse = <TModel extends Type<unknown>>(
  model: TModel | null,
  status: HttpStatus = HttpStatus.OK,
  options: { isArray?: boolean } = {},
) =>
  applyDecorators(
    ApiExtraModels(ResponseDto, ...(model ? [model] : [])),
    ApiResponse({
      status,
      schema: {
        allOf: [
          { $ref: getSchemaPath(ResponseDto) },
          {
            properties: {
              data: !model
                ? { type: 'null', nullable: true }
                : options.isArray
                  ? { type: 'array', items: { $ref: getSchemaPath(model) } }
                  : { $ref: getSchemaPath(model) },
            },
          },
        ],
      },
    }),
  );

export const ApiPaginatedResponse = <TModel extends Type<unknown>>(model: TModel) =>
  applyDecorators(
    ApiExtraModels(ResponseDto, PaginationMetaDto, model),
    ApiResponse({
      status: HttpStatus.OK,
      schema: {
        allOf: [
          { $ref: getSchemaPath(ResponseDto) },
          {
            properties: {
              data: { type: 'array', items: { $ref: getSchemaPath(model) } },
              meta: { $ref: getSchemaPath(PaginationMetaDto) },
            },
          },
        ],
      },
    }),
  );
